# Round 5 — v7 delta check

Reviewer pass: principal engineer. Scope: compile-verify the three type
mechanics, regression-read the restructuring, confirm closure still holds.
Prior artifacts: `code-review.md`, `-r2.md`, `-r3.md`, `-r4-closure.md`.

## Verdict

**All three mechanics compile as specified, in both directions, with controls.
No regressions. Closure holds.**

Two of the v7 changes make the interface meaningfully stronger than v5, not
merely equivalent: the `Outcome` conditional turns "did you pick an exit code?"
into a compile error at every return site of a catalogued command, and
`requireDependency` moves the missing-dependency prose from products into the
engine. Both close things I had accepted as convention or as product
responsibility in earlier rounds.

## (1) `Outcome<T, TCode>` — PASS, both directions

Tested verbatim through the full round trip (`defineCommand` inference →
`CommandHandler<typeof def>` → `ctx.present`). TypeScript 5.6, `--strict`.
Empty output; every assertion held.

Catalogued command (`exitCodes: { 4: '…', 5: '…' }`):

| Case | Expected | Result |
|---|---|---|
| `TCode` inferred | `4 \| 5`, both directions | ✓ |
| `present({ data, exitCode: 4 })` / `5` / `0` | compiles | ✓ |
| `present({ data, exitCode: 5, diagnostics: […] })` | compiles | ✓ |
| `present({ data })` — **exitCode omitted** | **rejected** | ✓ |
| `present({ data, exitCode: 7 })` | rejected | ✓ |

Uncatalogued command (no `exitCodes`):

| Case | Expected | Result |
|---|---|---|
| `present({ data })` | compiles | ✓ |
| `present({ data, diagnostics: [] })` | compiles | ✓ |
| `present({ data, exitCode: 4 })` | **rejected** | ✓ |

**Controls.** All three negative assertions were re-run with the offending
value corrected, and each produced `error TS2578: Unused '@ts-expect-error'
directive` — proving the assertions are load-bearing rather than vacuously
passing:

```
cA.ts(82,3): error TS2578: Unused '@ts-expect-error' directive.   # exitCode supplied → required-ness assertion was real
cB.ts(84,3): error TS2578: Unused '@ts-expect-error' directive.   # 7→5 → out-of-catalogue assertion was real
cC.ts(100,3): error TS2578: Unused '@ts-expect-error' directive.  # exitCode dropped → forbidden-ness assertion was real
```

The `[TCode] extends [never]` guard behaves correctly for an inferred union
(`4 | 5` takes the required branch) and for the default (`never` takes the
forbidden branch). This is the strongest form of the P02 fix: v5 made a wrong
code a compile error; v7 makes a *missing* code one too, so a command that
documents outcomes cannot silently exit 0 from a path the author forgot about.

## (2) `TConfig` through the grouped `needs` — PASS

`needs: { config: checkSection }` with `ConfigSection<CheckCfg>` still flows to
`ctx.config`. Both `const cfg: CheckCfg = ctx.config` and
`ctx.config.strict` typecheck. Nesting the inference site one level deeper
inside an optional property does not break it.

## (3) `ctx.config: TConfig` exactly — PASS

The no-config case types correctly: with no `needs.config`, `TConfig` defaults
to `undefined` and `const c: undefined = ctx.config` compiles. So dropping
`| undefined` does not strand commands that need no config.

Worth stating plainly, because it is a real shift in responsibility: absence is
now the validator's to model. A product whose section is genuinely optional
must type it as `T | undefined` and have its validator return that for absent
input. That is the right owner — the product knows whether absence is legal —
but it is a rule that lives only in the doc comment, and a validator typed `T`
that receives `undefined` will produce a confusing failure. One sentence in the
`ConfigSection` docs about the validator's input including `undefined` would
close it. Nit.

## (4) Regression read

**`help` / `args` / `needs` grouping.** Applied consistently across all three
kinds — `CommandDefinition`, `SessionCommandDefinition`, `ServerCommandDefinition`
each carry `help: HelpSpec`, `args?: ArgsSpec`, `needs?: NeedsSpec`. The
discriminants (`result-command`, `session-command`, `server-command`) are
intact and stamped by the `define*` functions via `Omit<…, 'kind'>`, so N03
stays closed. `raw` → `server-command` is a rename; naming is the architect's.

**`ProductManifest` + `createCli(products)`.** Good structural gain: the
manifest ties a product's config section to its commands, and the doc says
foreign-section references fail construction. That makes R10's "a command only
needs its own product's section" checkable at build time rather than trusted.
Note the association between a `MountedTree` entry and its manifest entry is a
construction-time check, not a type-level one — consistent with the existing
posture on collisions and grammar, so no new concern.

**`requireDependency` replacing `probeDependency`.** This is the best change in
v7. The engine now returns its own structured missing-dependency error with the
install command phrased from the detected package manager, and the handler just
passes it to `notOk`. `packageManager` correctly disappears from
`CommandContext` (it survives only on `Runtime` and the test spec), because
products no longer need it. My round-2 F26 residual — every product authoring
its own install prose, drifting per product — is now structurally impossible.
R13 still holds: the *command* returns the error, as the requirement words it;
only the wording moved to the engine.

**`Credentials` trimmed to `{ token }`.** No regression — nothing in the
interface consumed `workspaceId`, and treating workspace selection as session
state owned by the auth library is coherent.

**`PresentedResult.exitCode` / `diagnostics` now required.** Correct: the value
is engine-constructed, so both are always populated, and test code reading
`presented` no longer handles `undefined`. The optionality that remains is on
the *input* (`Outcome`), which is where it belongs.

**`Diagnostic` as a distinct foundation type.** Pure data, never thrown, no
stack — this resolves the round-3 P12 concern about live `Error` instances
crossing the boundary more cleanly than v5 did. `PresentedResult` is now plain
data throughout, so harness snapshots are stable.

**`NeedsSpec.interaction`.** The comment explaining why this is a mechanical
precondition and deliberately *not* an agent barrier — "the client's nature is
unverifiable, and a flag claiming to exclude agents would be a false guarantee"
— is exactly right, and worth keeping verbatim; it forecloses a bad feature
request permanently.

One nit: `NeedsSpec` is shared across all three kinds, so a
`ServerCommandDefinition` can declare `needs.interaction` even though prompts
do not apply to server commands. Harmless, unenforceable in the current shape,
and not worth restructuring for.

## Still open

Unchanged from the round-4 list, all previously graded nit or documentation:
P05 (flag defaults do not narrow — verified fix on file), P06 (no stated
terminal frame for sessions in json mode), P09 (`CommandHandler<D>` matches
only `CommandDefinition`, so session and server impl files hand-write their
signatures), P10 (`json + --quiet` precedence), plus the P11 nit list. Two
small additions from this round: the validator-input-includes-`undefined`
sentence above, and `NeedsSpec.interaction` on server commands.

## Acceptance criteria

Unchanged from round 4.

| Verdict | Count | Requirements |
|---|---|---|
| PASS | 10 | R1, R4, R5, R6, R7, R9, R10, R12, R13, R14 |
| WEAK | 2 | R2, R3 |
| FAIL | 0 | — |
| NOT VERIFIED | 2 | R8, R11 |

R6 and R13 both strengthened within their existing PASS — R6 because a missing
exit code is now a compile error, R13 because the install prose moved to the
engine. R10 strengthened via manifest-checked section ownership. The two
WEAKs are the same non-defects as before: **R2** is a review-and-lint property
no interface can carry, and **R3** is the one-line question of whether the
engine re-exports the foundation types (now four: `CliStructuredError`,
`Result`, `NextAction`, `Diagnostic`) so products import one package rather
than two — an architect call.

Closure holds. No further review pass needed from my lens.
