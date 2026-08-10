# S2a — Foundations (slice contract)

One PR into `main`, branch `s2a-foundations`. First of S2's four PRs
(`s2-overview.md`). Everything the later port PRs depend on lands here.
The v8 draft (`../assets/engine/engine-interface-draft.ts`) is
normative; the amendments this contract specifies are operator-ruled —
apply them to the draft in the same PR. Nothing in this contract is
open to implementer judgment; where a detail is not stated, the
reference implementation cited for it is the specification.

## 1. Engine publishable + production dependency

- `packages/cli-engine/package.json` gains publish metadata:
  `version: "0.1.0"`, `description` (one line: the execution engine of
  the unified Prisma CLI), `license: "Apache-2.0"`, `files: ["dist",
  "README.md", "LICENSE"]`, `repository` (type git, url
  https://github.com/prisma/prisma-cli.git, directory
  packages/cli-engine), `homepage`, `bugs`, `publishConfig: { access:
  "public" }`, `engines.node: ">=22.12.0"` (match `@prisma/cli`).
  Add `LICENSE` (copy root/cli Apache-2.0) and a minimal `README.md`
  (what the package is, the three subpaths, link to the repo). The
  operator publishes manually — no publish workflow in this PR.
- `@prisma/cli-engine` moves from `devDependencies` to `dependencies`
  of `packages/cli` (still `workspace:*`).
- `prepack` on cli-engine: `pnpm run build` (match sibling packages).

## 2. `ctx.api` — the management API client on the context

Operator-ruled: the client sits directly on `CommandContext`; no
extension mechanism.

- Engine gains dependency `@prisma/management-api-sdk` at the EXACT
  version `packages/cli` currently resolves (pin the resolved version,
  not a range; update the cli's own range to the same exact pin in
  this PR — committed-versions discipline).
- `Runtime` gains `readonly managementApi: { readonly baseUrl:
  string }`. The bin computes `baseUrl` exactly as
  `getApiBaseUrl(env)` does today (module moves in §3); the harness
  defaults it to `"https://test.invalid"` and `createTestCli`'s spec
  gains `managementApi?: { baseUrl?: string; client?:
  ManagementApiClient }` — when `client` is supplied, `ctx.api` IS
  that object (the uniform mock seam).
- `CommandContext` gains `readonly api: ManagementApiClient`.
  `ManagementApiClient` is a type alias the engine re-exports for the
  SDK's client type; consumers never import the SDK directly.
- Construction: lazy, once per run, on first property access (Proxy or
  getter — match how `execution/command-context.ts` builds the rest of
  the context; the client construction itself copies the current
  shell's construction in `packages/cli/src/controllers/auth.ts`
  (`createManagementApiSdk` call sites) with the token source backed
  by `ctx.getCredentials` so refresh during long runs is picked up
  per-request. That call site is the reference implementation; do not
  redesign it.
- Unauthenticated use: a command WITHOUT `needs.credentials` that
  touches `ctx.api` while `getCredentials()` resolves undefined gets a
  thrown `CliStructuredError` `CLI.CREDENTIALS_REQUIRED` — the same
  code, summary, and nextActions the needs-check failure uses (single
  source: the constructor already in `execution/needs.ts` — export and
  reuse it; no second phrasing).
- Draft amendment: §4 CommandContext (+`api`), §10 Runtime
  (+`managementApi`), §11 harness spec.
- Tests: context exposes the injected fake; lazy construction (no
  SDK construction when `api` untouched — assert via a throwing
  factory fake); unauthenticated throw path; refresh pickup (two
  `getCredentials` values across two `ctx.api` calls).

## 3. Auth module extraction

An internal module — NOT a workspace package (operator-ruled).

Moves (git mv; update every importer; zero behavior change):

| From | To |
| --- | --- |
| `packages/cli/src/adapters/token-storage.ts` | `packages/cli/src/auth/token-storage.ts` |
| `packages/cli/src/lib/auth/auth-ops.ts` | `packages/cli/src/auth/operations.ts` |
| `packages/cli/src/lib/auth/client.ts` | `packages/cli/src/auth/client.ts` |

New `packages/cli/src/auth/index.ts` — the module's ONLY public face;
everything else in `src/auth/` is internal to it. Exports exactly:
`readAuthState`, `performLogin`, `performLogout`, `FileTokenStorage`,
`EmptyServiceTokenError`, `isEmptyServiceTokenError`,
`SERVICE_TOKEN_ENV_VAR`, `getApiBaseUrl`, `CLIENT_ID`, the workspace
list/use/logout operations currently in `controllers/auth.ts`'s
real-mode helpers (`listRealAuthWorkspaces`, `useRealAuthWorkspace`,
`logoutRealAuthWorkspace` — extracted from the controller into
`src/auth/workspaces.ts`, controller delegates), and
`makeGetCredentials` (moved from `src/v8/runtime.ts`; the v8 runtime
imports it from here), plus `WorkspaceSelectionError` and
`StoredAuthWorkspace` (production consumers exist). The legacy shell
and controllers import ONLY via `src/auth/index.ts` — production code
rule; white-box TESTS of the module's own internals (and `vi.mock`
targets, which must name the module the code under test imports) are
the permitted exception. The `Credentials` shape stays the engine's
`{ token: string }` — S2a does not redesign it.

## 4. `auth *` family port

Mounted in the v8 bin under the existing `auth` group. All commands
are result commands in the platform command family. Fixture-mode-only
surface does not port (fixture machinery dies in S2d): `auth login`
loses `--provider`, `--user`, `--workspace` (mock-selection flags).

| Command | Args | needs | Behavior |
| --- | --- | --- | --- |
| `auth login` | none | none | Real OAuth flow via `performLogin` (browser open + poll), then `readAuthState`; events: `step-started/finished` for the flow, `endpoint` for the verification URL; presented like whoami's card plus the agent-setup tip line when `resolveAgentSetupTipCommand` fires (port that helper's real-mode path); nextActions: `auth whoami`, `project list`, the tip command when present |
| `auth logout` | flag `--workspace <ref>` (optional) | none | Without the flag: `performLogout` + `readAuthState`, card matching current logout copy, nextAction `auth login`. With the flag: the workspace-logout operation (same semantics as `auth workspace logout <ref>`, same presentation, same command — call the shared operation directly; the current shell's internal re-dispatch hack does not port) |
| `auth whoami` | none | none | Already ported (S1) — moves from `src/v8/auth/whoami.ts` handler calling `readAuthState` directly to the auth module import; otherwise untouched |
| `auth workspace list` | none | none | `listRealAuthWorkspaces`; table Block (name, id, status; source column only when mixed — port the exact column rules from `presenters/auth.ts`); json serializer ports `serializeAuthWorkspaceList` |
| `auth workspace use [workspace]` | optional positional | none | Resolves by id or case-insensitive name; ambiguous → `AUTH.WORKSPACE_AMBIGUOUS` errored (map the current error's content to nextActions form); absent positional + interactive → `prompt.select` over workspaces (clack path); absent + non-interactive → structural prompt failure (engine default) |
| `auth workspace logout <workspace>` | required positional | none | Port current semantics incl. was-active handling |

Error mapping: the current shell's flat codes port to dotted
`AUTH.*` codes, enumerated in the divergence list (pattern set by S1:
`AUTH_CONFIG_INVALID` → `AUTH.CONFIG_INVALID`, exit 1 → 2 for errored
paths). No documented 4–99 codes in this family.

Tests: semantic, per ruling — auth module stubbed at
`src/auth/index.ts` seam (vi.mock), `ctx.api` fake where workspaces
call the SDK; every command × (success, errored, json, unauth where
meaningful); prompt path for `workspace use` via scripted answers.
Delete `packages/cli/tests/auth.test.ts` fixture-mode cases that cover
ported commands; keep the file's untouched-shell cases until S2d.

## 5. Update check port

- `packages/cli/src/shell/update-check.ts` moves to
  `packages/cli/src/update-check.ts`; its `CliRuntime` parameter
  narrows to the exact fields it uses (type them structurally so both
  shells satisfy it). The legacy shell keeps consuming it; the v8 bin
  (`src/v8/main.ts`) wires it identically to the legacy shell's two
  touchpoints: read-and-notify before the run's output settles is NOT
  the current behavior — copy the CURRENT sequencing exactly (cached
  notify + detached refresh spawn; consult the legacy call sites as
  the reference implementation). Notification line goes to stderr.
- Tests: notify-when-cached-newer, refresh-spawn arguments, silence
  inside the notification interval, silence in json format (decide by
  the current behavior — if the legacy shell prints it in json mode
  today, KEEP that and record it in the divergence list; do not
  invent a new rule).

## 6. Telemetry

Operator-ruled: essential, identical to the ORM CLI's mechanism; the
implementation moves to this repo.

- New workspace package `packages/cli-telemetry`, name
  `@repo/cli-telemetry`, `private: true` (bundled into the cli — it
  must appear in the cli's tsdown bundle, not as a published dep).
  Source ported from prisma/prisma `packages/1-framework/3-tooling/
  cli-telemetry` (reference clone: `wip/repos/prisma`). Preserve
  UNCHANGED: the user-config path and format (shared installation id
  with the ORM CLI), gating resolution (consent state, CI detection,
  env opt-outs), the detached-subprocess sender, endpoint and wire
  protocol, the sanitizer's value-free discipline.
- Replace the Commander snapshot type with the engine shape:
  `EngineCommandSnapshot { commandPath: readonly string[]; flags:
  ReadonlyArray<{ name: string; source: "cli" | "env" | "default" }>;
  positionalCount: number }` — no values, ever.
- Engine amendment: `RunHooks` gains `onSettled?: (summary:
  RunSummary) => void` where `RunSummary { commandId: string;
  exitCode: number; durationMs: number; snapshot:
  EngineCommandSnapshot }`, fired exactly once per run after
  settlement, never for `--help`/`--version`, errors in the hook are
  swallowed (a telemetry bug must not break a command). Draft §10
  amendment. `durationMs` from the injectable clock.
- Bin wiring (`src/v8/main.ts`): resolve gating; when enabled, pass an
  `onSettled` hook that spawns the detached sender — sequencing and
  spawn semantics copied from the ORM CLI's `preAction`/util wiring
  (reference: `wip/repos/prisma/.../cli/src/utils/telemetry.ts`).
- Commands `telemetry status|enable|disable` port from the ORM CLI's
  consent surface as engine result commands, mounted shell-owned (no
  family), group `telemetry`. Copy the ORM's semantics and copy;
  presented as cards; json serializers included.
- Tests: sanitizer (engine snapshot → wire shape), gating matrix
  (consent × CI × env), hook firing (once, correct summary, swallowed
  throw), consent commands.

## 7. Clack prompt renderer

Land the spike design (spike branch `spike/clack-prompts`, commit
903b25a — reference implementation; reimplement cleanly, do not
cherry-pick):

- `@clack/prompts` exact-pinned `1.5.0`, engine dependency, loaded by
  dynamic import only on the interactive path.
- New `packages/cli-engine/src/execution/clack-renderer.ts`: stream
  adapters (`Readable.from` over `Runtime.stdin` with `setRawMode`
  forwarded; `Writable` over stderr `OutputStream`), prompt mapping
  for confirm/consent/select/text with `{ input, output }` injection.
- Branch condition in `execution/prompts.ts`: clack renders IFF no
  scripted answers AND `runtime.isTty.stdin` AND
  `runtime.stdin.setRawMode` is present; otherwise the existing plain
  line renderer. Structural failures and `--yes` resolution stay
  BEFORE the branch. Cancellation maps to the existing
  `CLI.PROMPT_CANCELLED` path. Clack spinners/log helpers are
  forbidden (process-global handlers): progress remains engine
  events.
- Draft amendments: two-tier rendering note (§4a); select's
  Enter-picks-highlighted note; the accepted
  `process.stdout.columns` read quirk.
- Tests: fake raw-mode stdin fixture driving confirm/select/text
  through the clack path (assert resolved values + stderr-only
  writes); cancellation byte (`\x03`) → exit 3; harness/scripted path
  proven clack-free (dynamic import spy).

## Out of scope

`project`/`postgres`/`bucket`/`branch` (S2b), `service`/`build`/`git`/
`agent`/`feedback` (S2c), `init` + shell deletion + fixture removal
(S2d), engine version bumps beyond 0.1.0, Credentials shape redesign,
`composer` root (S3).

## Acceptance

- [ ] Operator has published `@prisma/cli-engine@0.1.0` (metadata PR
      landed first; publish is the operator's single action).
- [x] `ctx.api` on the context with the harness `client` override;
      draft amended; refresh-pickup test green.
- [x] Auth module extracted; legacy shell green against it; v8 runtime
      consumes `makeGetCredentials` from it.
- [x] All six `auth *` commands on the engine with semantic tests;
      fixture-only flags gone; divergence list updated.
- [x] Update check ported to both shells; sequencing matches legacy.
- [x] Telemetry: package ported, hook amendment landed, bin wired,
      consent commands mounted, sanitizer value-free by test.
- [x] Clack renderer landed per spike; all prompt tests green
      including the clack-path fixture suite.
- [x] Root verification: engine + cli suites, typecheck, lint exit 0.
- [ ] PR ≥1k LOC (expected: well above), divergence list reviewed.
