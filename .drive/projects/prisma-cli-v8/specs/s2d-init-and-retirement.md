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

R-S2d-1a **`init`'s dependency install**: today's `init` installs the
compute SDK by spawning the user's package manager through execa
(`packages/cli/src/controllers/init.ts`) — a step this contract did not
previously mention. It ports onto the engine's package-manager
capability: the handler declares `installsPackages: true` and calls
`ctx.packages.install(...)`; it does not spawn, spell a manager command
line, or phrase the failure itself. The current behavior of treating a
failed install as a warning and continuing (rather than failing the
command) is preserved — the capability returns a `Result`, so the
handler keeps that choice. Prerequisite: the capability must have
landed (`engine-package-manager-capability.md`); until it does, this
sub-rule is the reason `init` cannot be ported.

R-S2d-2 **`version`**: the engine's `--version` surface already
exists; the `version` COMMAND ports as a result command presenting
the inventory's current fields (version, node, platform) with a json
serializer. Trivial but user-visible; test matrix applies.

R-S2d-3 **The bin cutover**: `packages/cli/package.json` `bin` (`prisma-cli`) points at the v8 entry; the tsdown build bundles the v8 tree; the `prisma-v8` working name and root script are deleted. The config-loader plain-Node constraint is resolved: RULED (operator, 2026-08-11) to copy prisma/prisma and prisma/composer, which both load the config with `c12` — a dependency, dynamically imported, called as `loadConfig({ name, cwd, configFile? })`. `c12@3.3.4` depends on `jiti` directly, so an ordinary `dependencies` entry is all that has to be declared; its only peer dependency is `magicast`, which is optional. Nothing to design; port their shape. This no longer blocks any part of the slice.

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

- [x] `init` wizard green on the full prompt matrix (interactive,
      `--yes`, non-interactive, cancel) with byte-asserted templates.
- [x] Bin cutover complete, config loaded through `c12` as the
      reference repositories do; `prisma-cli` runs the
      engine shell from a packed tarball on plain Node.
- [x] Commander shell + fixture machinery deleted per R-S2d-4's
      checklist; survivor list enumerated.
- [x] Grammar completeness test green (landed via S7's `check:grammar`; `version` is a ruled removal, and the ORM's initializer moved to `orm init` so top-level `init` is the platform wizard — operator, 2026-08-12).
- [x] Consolidated divergence document reviewed and RATIFIED by the operator (2026-08-12).
- [x] Root verification green; PR ≥1k LOC; review loop run; S2 slice
      closed in the project plan.
