# Engine spec — redirect tables in command-family metadata

Status: ruled 2026-08-11; §2 amended 2026-08-11 after a design review against the shipped engine (the amendments are listed at the end of this section). Deliverable: one PR to `packages/cli-engine`. The first consumer is the ORM family (ported in prisma/prisma), which carries two retired verbs and four retired flags; the surface in §2 is a cross-repo contract — names are frozen unless the operator re-rules.

Amendments, all operator-ruled 2026-08-11:

1. `from` is the path the user types — an absolute path in the mounted tree, the same convention as `MountedTree` keys. The original text called it relative to the family's mount position; a family has no mount position (the shell mounts each command individually, and a family's commands are routinely scattered across several roots), and a relative path would not match what the user typed anyway. Families declare their redirects; `createCli` mounts them, exactly as it mounts commands.
2. A `from` that resolves to anything already in the tree — a command **or a group** — is a construction error. Live commands do not take precedence over redirects, because an overlap is never a legitimate steady state.
3. `replacement` is rendered by the help-example convention that already ships, so a missing `{bin}` is no longer a construction error.
4. Flag redirects ship in the same PR; the option to split them into a follow-up is withdrawn (stricli exports `FlagNotFoundError` carrying the offending flag, so the interception is ordinary work).
5. Cataloguing `CLI.COMMAND_MOVED` alongside the engine's other codes is deferred to project close-out, when the full error list has settled. No code catalogue exists yet, and this PR does not create one.

## 1. What this is and why

When a CLI renames a command, users and scripts keep typing the old name for years. The ORM CLI keeps a table of retired invocations (`migration apply` → `migrate --to`, `migration ref` → `ref set|list|delete`, plus four removed `migration status` flags) and answers them with a targeted "use X instead" message rather than a generic unknown-command error.

The engine has no way to express this today. Registering the dead names as real commands puts them in help and in the grammar tree forever, and a family cannot write a runnable replacement invocation with the binary name in it: the same family mounts under `prisma-next` now and `prisma` at cutover, and the operator's 2026-08-09 ruling keeps binary names out of family-authored invocations entirely.

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
      replacement: 'migrate --to <ref>',
      reason: 'migration apply was replaced by migrate --to.',
    },
    {
      from: 'migration ref',
      replacement: 'ref set|list|delete',
      reason: 'Refs are managed by the ref command group.',
    },
    {
      from: 'migration status',
      flag: 'graph',
      replacement: 'migration graph',
      reason: 'The --graph flag became its own command.',
    },
  ],
})
```

Two types, following the `HelpSpec` → `CommandHelp` pattern the engine already uses: the ergonomic one you write, and the total one the family carries.

```ts
/** What you declare. */
interface RedirectSpec {
  /** The retired invocation as the user types it: a space-separated
   *  absolute path in the mounted tree, the same convention as
   *  MountedTree keys. */
  readonly from: string;
  /** When present, this is a retired FLAG on a live command: `from` names
   *  the live command's path and `flag` the retired flag's camelCase name
   *  (rendered --kebab-case, as flag declarations are). */
  readonly flag?: string;
  /** The replacement invocation, written the way help examples are
   *  written: no binary name, `{bin}` available when the name has to sit
   *  mid-string. Placeholder arguments use angle brackets (`<ref>`). */
  readonly replacement: string;
  /** One sentence of context, surfaced as the error's `why`. */
  readonly reason?: string;
}

/** What the normalized family carries. */
interface CommandRedirect {
  readonly from: string;
  readonly flag: string | undefined;
  readonly replacement: string;
  readonly reason: string | undefined;
}
```

`redirects` is optional; normalized definitions carry it as an always-present (possibly empty) readonly array of `CommandRedirect`, per the no-conditional-properties ruling. Annotate a declaration with `RedirectSpec`, not `CommandRedirect` — the latter's keys are all required.

Families declare their redirects; `createCli` collects them from every mounted family into one table, the same way it collects commands. Nothing about a redirect is relative to its family — `from` is what the user types.

### 2.2 Behavior

**Verb redirects** (`flag` absent). When argv fails to resolve to any mounted command and the attempted path exactly matches a redirect's `from`, the run settles as an ERRORED envelope:

- Code: **`CLI.COMMAND_MOVED`** (new, engine-owned). Exit 2.
- Summary: `` `<attempted path>` has been replaced``; `why` from `reason` when present.
- `nextActions`: one `run-command` action, `label` "Use the replacement", `command` = `replacement` rendered by the help-example convention — `{bin}` substituted with `createCli`'s `name` when present, the name prepended when it is not. An angle-bracket placeholder in the command follows the documented placeholder convention (user substitutes the value).

Longest-match wins if a redirect path prefixes another; matching is exact on path segments, never fuzzy. When no redirect matches, unknown-command behavior is exactly what it is today.

**Flag redirects** (`flag` present). When a *live* command's parse fails on an unknown flag and the (command path, flag) pair matches an entry, the parse failure is replaced by the same `CLI.COMMAND_MOVED` envelope (the flag named in the summary: `` `--graph` on `migration status` has been replaced``). When no entry matches, today's unknown-flag error is untouched.

### 2.3 Construction-time validation (fail at `createCli`, like every other tree defect)

- A verb redirect (`flag` absent) whose `from` resolves to anything already in the tree — a mounted command **or a group** — is a construction error. The group half matters: stricli resolves a bare group path to the help integration, so it never reaches the unknown-command branch, and a redirect sitting there could never fire. Live commands do not silently win; the tree is wrong and says so at construction.
- A flag redirect (`flag` present) whose `from` does NOT name a mounted command is a construction error.
- A flag redirect whose `flag` is not camelCase is a construction error, the same rule flag declarations obey. Matching camel-cases what the user typed, so a `flag` stored as `old-flag` can never be hit: the entry looks plausible and silently does nothing. Added 2026-08-11 after review.
- A `from` that is empty once normalized is a construction error: nothing can produce it.

`from` is normalized when a `RedirectSpec` becomes a `CommandRedirect` — trimmed, with every run of whitespace collapsed to a single space, so `'  migration \t apply '` is stored as `'migration apply'`. A path is a sequence of segments and whitespace is only the separator between them, so a doubled space or a tab has exactly one sensible reading and the engine takes it rather than refusing the declaration. This matters because lookup rejoins the user's argv tokens with single spaces: an un-normalized key holding a doubled space is one no invocation could ever produce, and it would sit in the table silently matching nothing. Added 2026-08-11 (operator) after the first version shipped without it.
- A flag redirect whose `flag` IS declared by the named command is a construction error.
- Two redirects with the same `from` (and, for flag entries, the same `flag`) are a construction error.

The first and last of these bind across families: `createCli` validates the merged table, so two families cannot each claim the same retired path.

### 2.4 Non-behavior

- Redirect entries never appear in `--help` at any level.
- They are invisible to grammar-completeness checks (S7's tree check ignores them).
- They are never executable; there is no handler.
- Telemetry: a redirect settlement reports like any other unmounted/errored run under the existing rules — no new telemetry surface.

## 3. Testing

- Unit: matching (exact on path segments, longest-match, no fuzzy, a redirect under a live group), replacement rendering both with and without `{bin}`, each construction-time validation, flag-redirect interception, help output proven free of redirect entries.
- Harness: `createTestCli` needs no new seams — tests assert the `CLI.COMMAND_MOVED` envelope, exit code, and next action through the existing `run()` result.
- Type tests: `redirects` optional on the spec input, always-present on the normalized family.

## 4. Coordination

- Lands in `packages/cli-engine`, ships in a published `@prisma/cli-engine` version; the ORM port consumes it only from the published package and its round is sequenced behind that publish (with a fallback: if unpublished when the port reaches it, the ORM ships without redirects and adds them in a follow-up — the port does not block on this).
- The implementation branches off this document's branch (`spec/redirect-table`, PR #141) so the ruled contract travels with the code, and its PR stacks on #141 — retarget to `main` when #141 merges. The S3/Composer stream and the init/shell-retirement stream both have in-flight changes in `execution/command-tree.ts`, `execution/stricli-adapter.ts`, `execution/settlement.ts` and `execution/engine.ts`, so merge down from `main` before opening and expect conflicts in those four files. The package-manager capability (a sibling engine spec) lands independently; its surface is `defineCommand` and `Runtime`, which this PR does not touch.
- Where this document and the shipped engine source disagree on existing mechanisms, follow the code's established patterns.

## 5. Acceptance

- [ ] `defineCommandFamily` accepts `redirects`; normalized families always carry the array; `createCli` merges every family's entries into one table.
- [ ] A retired verb settles as `CLI.COMMAND_MOVED`, exit 2, with a `run-command` next action carrying the rendered replacement; unmatched unknowns behave exactly as before.
- [ ] A retired flag on a live command settles the same way.
- [ ] All six construction-time validations fail at `createCli` with clear messages.
- [ ] No redirect appears in any help output (test-proven).
