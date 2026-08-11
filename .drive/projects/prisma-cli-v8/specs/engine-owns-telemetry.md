# Engine spec — the engine owns telemetry reporting

Status: ruled 2026-08-11 (operator: telemetry reporting is not a consumer's responsibility; it belongs in the engine). Deliverable: one PR to `packages/cli-engine`, plus the mechanical deletion of the shell's copy. The second consumer is the ORM's `prisma-next` bin, which must not have to re-implement any of this.

## 1. What this is and why

The engine already produces everything telemetry needs — `RunSummary` (command path, flag names with their source, positional count, exit code, duration) delivered exactly once per run through `CliRunHooks.onSettled` (`cli-engine/src/run-summary.ts`, `cli.ts:15,50`). It stops there. Sending is left to each consumer, and today the platform shell does it in 136 lines of bin code (`packages/cli/src/v8/telemetry/reporting.ts`): resolve gating, print the first-run disclosure, resolve the sender's path, attach the hook, spawn the detached sender, swallow every failure.

That leaves the ORM's `prisma-next` bin to write the same 136 lines against a second copy of the telemetry package, with the same installation id, the same endpoint, the same wire shape, and the same first-run disclosure — and any drift between the two is a silent reporting inconsistency across binaries that are supposed to be one product. The project's own framing has the engine owning "argv parsing, help, output envelopes, JSON mode, prompts, consent, **telemetry**, error presentation, and exit codes". Reporting is the half that never landed.

There is no purity argument against it: the engine already constructs an authenticated API client (`ctx.api`) and opens URLs through the runtime. Telemetry is one more engine-owned side surface with a bin-supplied seam for the actual process work.

## 2. The surface

### 2.1 Declaration at `createCli`

```ts
createCli({
  name,
  version,
  commandFamilies,
  groups,
  commands,
  telemetry: {
    endpoint: 'https://…',            // where events go
    docsUrl: 'https://…',             // named in the first-run disclosure
    disableEnvVars: ['PRISMA_NEXT_DISABLE_TELEMETRY'],  // product opt-outs; DO_NOT_TRACK is always honored
    enrich?: (summary: RunSummary) => Record<string, unknown>,  // product-specific payload fields
  },
})
```

Omitting `telemetry` means the CLI reports nothing — the engine attaches no hook and reads no config. There is no default endpoint.

### 2.2 What the engine does with it

Once per run, in this order:

1. **Resolve gating** before the command dispatches, from (in precedence order): `DO_NOT_TRACK`, the product's `disableEnvVars`, CI detection, the stored user preference. The resolved decision carries its reason (`env-override`, `ci`, `stored-opt-out`, `default-on`, `stored-opt-in`) and is readable by commands through `ctx.telemetryStatus` (§2.3) so a product's own `telemetry status` command needs no private access.
2. **Print the first-run disclosure** when telemetry is enabled and no user config exists yet — pre-run, to stderr, naming the docs URL, the config file path, the environment opt-outs, and the product's own disable command when one is mounted. Timing is the ratified one: disclosure pre-run, event at settlement.
3. **Mint and store the installation id** on first enabled run (a v4 UUID in the user-level config, never rotated, never derived from anything machine-identifying).
4. **Attach the settlement hook** and, at settlement, emit the event through the runtime seam below. Never for `--help`/`--version`, never for a run that failed before reaching a mounted command (the existing `RunSummary` contract).
5. **Swallow every telemetry failure.** A telemetry fault never changes an exit code, never writes to a command's output, and never delays settlement beyond handing the payload to the seam.

Payload fields the engine owns: installation id, CLI name and version, command path, flag names with `source`, positional count, exit code, duration, platform/arch/node version, CI flag. **Values are never collected** — not flag values, not positionals, not paths, not error messages. `enrich` may add product fields and is subject to the same rule; the engine redacts anything matching its secret-shaped patterns before sending.

### 2.3 `ctx.telemetryStatus`

```ts
interface TelemetryStatus {
  readonly enabled: boolean;
  readonly reason: 'env-override' | 'ci' | 'stored-opt-out' | 'stored-opt-in' | 'default-on' | 'not-configured';
  readonly configPath: string;          // the user-level config file
  readonly installationId?: string;     // present only when one has been minted
}
```

Always present on `CommandContext` (no capability declaration). Read-only. This is what a product's `telemetry status` command renders, and what `telemetry enable|disable` mutate through §2.4.

### 2.4 Mutating the preference

```ts
ctx.telemetry.setEnabled(enabled: boolean): Promise<Result<TelemetryStatus, CliStructuredError>>
```

Available on commands declaring `managesTelemetry: true` (capability, same pattern as `managesCredentials`). Writes the user-level config, mints the installation id when enabling, and returns the new status. This exists so the *commands* `telemetry enable|disable` are thin presentation over an engine-owned store rather than each product owning the file format.

**Whether the engine should also ship the three `telemetry status|enable|disable` commands themselves** (mountable by a product with one line, instead of each product writing its own presentation) is left to the implementer to propose in the PR; the operator's instinct is that the CLI's telemetry commands are as much engine surface as its `--json` flag is. Ship §2.3/§2.4 regardless — the commands can follow.

### 2.5 The runtime seam

```ts
interface Runtime {
  // …existing members…
  spawnTelemetry?: (spec: {
    readonly payload: unknown;
    readonly endpoint: string;
    readonly signal: AbortSignal;
  }) => void;   // fire-and-forget; the bin owns detachment
}
```

The engine composes and redacts the payload; the bin spawns. Absent seam means no reporting (and no error). The engine imports no `child_process` and performs no network I/O for telemetry itself. `createTestCli` gains a `telemetrySpawner` seed so a product's telemetry behavior is assertable offline; tests never contact a real endpoint.

## 3. Migration of the existing consumer

`packages/cli/src/v8/telemetry/reporting.ts` and `is-ci.ts` are deleted; `main.ts`'s `resolveTelemetryHooks` wiring is replaced by the `telemetry` block on `createCli`. `@repo/cli-telemetry`'s sender becomes the bin's `spawnTelemetry` implementation. The gating, user-config, and payload modules move into the engine (they are the engine's now); the detached sender process stays with the bin. **The wire shape, endpoint, user-config file path, and installation id must not change** — an existing user's id survives, and events from the platform CLI before and after this change are indistinguishable to the backend.

## 4. Testing

- Gating precedence table (every env/CI/stored combination), disclosure fires exactly once and only on first enabled run, id minted once and never rotated, no event for `--help`/`--version`/unmounted runs, event emitted exactly once at settlement.
- A telemetry fault (throwing spawner, unwritable config, malformed stored config) changes nothing observable about the run — asserted on exit code, stdout, stderr.
- No values in the payload: a run with flag values, positionals and a failing command asserts the payload contains names and counts only.
- The platform CLI's existing telemetry tests port onto the new surface and must keep passing unchanged in intent.

## 5. Coordination

- Lands in `packages/cli-engine` and ships in a published `@prisma/cli-engine`; consumers pick it up by version.
- Touches `cli.ts`, `context.ts`, `runtime.ts`, `testing.ts`, `run-summary.ts` — the same files as the package-manager capability (spec `engine-package-manager-capability.md`, PR #140) and the S3/Composer stream. Sequence with the operator.
- **The ORM port depends on this for its cutover** (the round that hands the `prisma-next` binary to the engine-built bin). Until it publishes, the ORM's new bin reports nothing and the commander CLI keeps reporting as it always has — no user-visible gap, because the commander CLI owns the binary until then.

## 6. Acceptance

- [ ] `createCli({ telemetry })` is the only wiring a consumer writes; no consumer re-implements gating, disclosure, id minting, or hook attachment.
- [ ] Gating precedence, disclosure timing, and id lifetime match the current shipped behavior exactly.
- [ ] `ctx.telemetryStatus` on every context; `ctx.telemetry.setEnabled` under `managesTelemetry: true`.
- [ ] Payload carries no values from argv; `enrich` output is redacted the same way.
- [ ] Every telemetry failure is invisible to the run.
- [ ] `createTestCli` seeds a spawner; no test reaches a real endpoint.
- [ ] The platform shell's `reporting.ts`/`is-ci.ts` are deleted and its telemetry tests pass against the engine surface.
- [ ] Wire shape, endpoint, config path and installation ids are unchanged for existing users.
