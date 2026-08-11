# Engine spec — redirect tables in command-family metadata

Status: ruled 2026-08-11. Deliverable: one PR to `packages/cli-engine`. The first consumer is the ORM family (ported in prisma/prisma), which carries two retired verbs and four retired flags; the surface in §2 is a cross-repo contract — names are frozen unless the operator re-rules.

## 1. What this is and why

When a CLI renames a command, users and scripts keep typing the old name for years. The ORM CLI keeps a table of retired invocations (`migration apply` → `migrate --to`, `migration ref` → `ref set|list|delete`, plus four removed `migration status` flags) and answers them with a targeted "use X instead" message rather than a generic unknown-command error.

The engine has no way to express this today. Registering the dead names as real commands puts them in help and in the grammar tree forever, and a family cannot write a runnable replacement invocation without hard-coding a binary name — forbidden by R12, because the same family mounts under different binaries (`prisma-next` now, `prisma` at cutover).

So the engine gains a **redirect table** on `CommandFamily`: declarative metadata, consulted only when an invocation fails to resolve. Redirect entries are not commands: they never appear in help, never occupy the grammar tree, and cannot be executed.

## 2. The surface

### 2.1 Declaration

```ts
defineCommandFamily({
  configSection,
  commands,
  docsBaseUrl,
  redirects: [
    {
      from: 'migration apply',
      replacement: '{bin} migrate --to <ref>',
      reason: 'migration apply was replaced by migrate --to.',
    },
    {
      from: 'migration ref',
      replacement: '{bin} ref set|list|delete',
      reason: 'Refs are managed by the ref command group.',
    },
    {
      from: 'migration status',
      flag: 'graph',
      replacement: '{bin} migration graph',
      reason: 'The --graph flag became its own command.',
    },
  ],
})
```

```ts
interface CommandRedirect {
  /** Space-separated command path, relative to wherever the shell mounts
   *  this family's commands — same convention as MountedTree keys. */
  readonly from: string;
  /** When present, this is a retired FLAG on a live command: `from` names
   *  the live command's path and `flag` the retired flag's camelCase name
   *  (rendered --kebab-case, as flag declarations are). */
  readonly flag?: string;
  /** The replacement invocation. `{bin}` is substituted with the CLI's
   *  binary name at render time, exactly as help examples substitute it.
   *  Placeholder arguments use angle brackets (`<ref>`). */
  readonly replacement: string;
  /** One sentence of context, shown as the next action's reason. */
  readonly reason?: string;
}
```

`redirects` is optional; normalized definitions carry it as an always-present (possibly empty) readonly array, per the no-conditional-properties ruling.

### 2.2 Behavior

**Verb redirects** (`flag` absent). When argv fails to resolve to any mounted command and the attempted path exactly matches a redirect's `from` (resolved against the family's mount position, the same way the shell namespaces the family's commands), the run settles as an ERRORED envelope:

- Code: **`CLI.COMMAND_MOVED`** (new, engine-owned, registered wherever the engine catalogues its codes). Exit 2.
- Summary: `` `<attempted path>` has been replaced``; `why` from `reason` when present.
- `nextActions`: one `run-command` action, `label` "Use the replacement", `command` = `replacement` with `{bin}` substituted with `createCli`'s `name`. An angle-bracket placeholder in the command follows the documented placeholder convention (user substitutes the value).

Longest-match wins if a redirect path prefixes another; matching is exact on path segments, never fuzzy. When no redirect matches, unknown-command behavior is exactly what it is today.

**Flag redirects** (`flag` present). When a *live* command's parse fails on an unknown flag and the (command path, flag) pair matches an entry, the parse failure is replaced by the same `CLI.COMMAND_MOVED` envelope (the flag named in the summary: `` `--graph` on `migration status` has been replaced``). When no entry matches, today's unknown-flag error is untouched. If intercepting the parser's unknown-flag failure proves disproportionate (it lives in the stricli adapter), the implementer may split flag redirects into a follow-up PR — verb redirects are the priority; say so in the PR if split.

### 2.3 Construction-time validation (fail at `createCli`, like every other tree defect)

- A redirect `from` that collides with a mounted command path (or, with `flag`, names a command path that does NOT exist) is a construction error.
- A redirect `from` that collides with another redirect is a construction error.
- A `replacement` not containing `{bin}` is a construction error — it is the mechanism that keeps binary names out of family code.
- A `flag` entry whose flag IS declared by the named command is a construction error.

### 2.4 Non-behavior

- Redirect entries never appear in `--help` at any level.
- They are invisible to grammar-completeness checks (S7's tree check ignores them).
- They are never executable; there is no handler.
- Telemetry: a redirect settlement reports like any other unmounted/errored run under the existing rules — no new telemetry surface.

## 3. Testing

- Unit: matching (exact, namespaced under a mount, longest-match, no fuzzy), `{bin}` substitution, each construction-time validation, flag-redirect interception, help output proven free of redirect entries.
- Harness: `createTestCli` needs no new seams — tests assert the `CLI.COMMAND_MOVED` envelope, exit code, and next action through the existing `run()` result.
- Type tests: `redirects` optional on the spec input, always-present on the normalized family.

## 4. Coordination

- Lands in `packages/cli-engine`, ships in a published `@prisma/cli-engine` version; the ORM port consumes it only from the published package and its round is sequenced behind that publish (with a fallback: if unpublished when the port reaches it, the ORM ships without redirects and adds them in a follow-up — the port does not block on this).
- The S3/Composer stream and the package-manager-capability implementer are editing the same package (`command-family.ts`, `cli.ts`, `execution/command-tree.ts`, `execution/stricli-adapter.ts` overlap) — sequence with the operator.
- Where this document and the shipped engine source disagree on existing mechanisms, follow the code's established patterns.

## 5. Acceptance

- [ ] `defineCommandFamily` accepts `redirects`; normalized families always carry the array.
- [ ] A retired verb settles as `CLI.COMMAND_MOVED`, exit 2, with a `{bin}`-substituted `run-command` next action; unmatched unknowns behave exactly as before.
- [ ] A retired flag on a live command settles the same way (or the split is declared in the PR).
- [ ] All four construction-time validations fail at `createCli` with clear messages.
- [ ] No redirect appears in any help output (test-proven).
- [ ] `CLI.COMMAND_MOVED` documented in the engine's code catalogue.
