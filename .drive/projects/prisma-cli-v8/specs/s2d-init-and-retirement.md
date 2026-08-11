# S2d — Init and shell retirement (slice contract)

One PR into `main`, branch `s2d-init-and-retirement`, after S2c
merges. Ports `init` and `version`, deletes the commander shell and
fixture machinery, and makes the v8 bin the shipped binary. Closes
slice S2.

Sources and precedence as in `s2b-resources.md`. S2b rules apply where
relevant. Additional rules:

R-S2d-1 **`init`**: result command; the wizard runs on the engine
prompt surface (clack path from S2a): the inventory's step list is the
contract (project name, template/framework selection, linking
question, env write-out, agent-setup offer). Consent semantics: file
writes into a non-empty directory follow the current confirmation
behavior via `prompt.confirm`; `--yes` accepts defaults per engine
rules; every prompt has the inventory's current default. File-writing
side effects byte-match current templates (template files are data,
not rendering — they stay byte-asserted). The auth-linking step uses
`needs`-free auth probing like `auth whoami` (state read, no forced
login) + a sign-in nextAction when unauthenticated (R-S2b-2 spirit;
enumerate divergence from any legacy auto-login).

R-S2d-2 **`version`**: the engine's `--version` surface already
exists; the `version` COMMAND ports as a result command presenting
the inventory's current fields (version, node, platform) with a json
serializer. Trivial but user-visible; test matrix applies.

R-S2d-3 **The bin cutover**: `packages/cli/package.json` `bin`
(`prisma-cli`) points at the v8 entry; the tsdown build bundles the
v8 tree; the `prisma-v8` working name and root script are deleted.
The config-loader plain-Node constraint (S1 deferral) must be
resolved HERE: the shipped bin cannot require tsx. Resolution is
pinned: the loader gains the jiti-style evaluation the S3 plan
expected — STOP: that is not pinned anywhere. Morning-questions
ledger Q4 records the decision needed (config evaluation strategy for
the published bin: jiti, esbuild-register, or native TS supported
runtimes only). DO NOT start D-dispatches for R-S2d-3 until Q4 is
ruled; everything else in S2d can proceed.

R-S2d-4 **Deletions** (after all ports green; single dedicated
commit series): the commander shell (`src/cli.ts` program wiring,
`src/shell/*` minus the modules S2a relocated), fixture machinery
(`src/adapters/mock-api.ts`, `src/use-cases/**`, fixture providers,
`isRealMode` branches — the inventory's "what dies" list is the
deletion checklist), all remaining fixture-mode tests, the
`PRISMA_CLI_MOCK_FIXTURE_PATH` env surface, and `--trace`. Legacy
presenters/controllers survive ONLY where S2b/S2c handlers still call
them as operation layers (enumerate survivors in the PR). Known
survivors as of S2a: `src/state-dir.ts` (relocated out of the shell;
`shell/runtime.ts` merely re-exports it) and the `CliError` base class
in `shell/errors.ts` — `src/auth/errors.ts` still constructs CliError
instances (the auth module's one remaining legacy dependency) and
`src/v8/auth/errors.ts` maps them to structured errors; when the
legacy shell dies, either CliError moves to a durable home or the auth
operations throw structured errors directly and both mapping layers
go.

R-S2d-5 **Grammar completeness check**: a build-time test asserts the
mounted tree equals the S2 target grammar exactly (every inventory
command minus ruled removals plus ruled renames; `service run` is
a ruled removal, so nothing of the legacy shell survives on its
account). This is the platform slice of the S7 grammar check.

R-S2d-6 **Final parity review**: the cumulative S2 divergence list
(S2a+S2b+S2c+S2d) is consolidated into one document for operator
sign-off: `../assets/s2/parity-divergences.md`.

## Out of scope

Composer (S3), ORM (S5), publish pipeline (S7), auto-login
reinstatement (Q1 unless ruled meanwhile).

## Acceptance

- [ ] `init` wizard green on the full prompt matrix (interactive,
      `--yes`, non-interactive, cancel) with byte-asserted templates.
- [ ] Bin cutover complete per Q4's ruling; `prisma-cli` runs the
      engine shell from a packed tarball on plain Node.
- [ ] Commander shell + fixture machinery deleted per R-S2d-4's
      checklist; survivor list enumerated.
- [ ] Grammar completeness test green.
- [ ] Consolidated divergence document reviewed by the operator.
- [ ] Root verification green; PR ≥1k LOC; review loop run; S2 slice
      closed in the project plan.
