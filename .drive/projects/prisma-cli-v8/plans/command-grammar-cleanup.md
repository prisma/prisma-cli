# Command grammar cleanup — dispatch plan

Slice contract: `specs/command-grammar-cleanup.md`. One PR into `main`, this worktree's branch. Sequential dispatches; each hands the next a state where `pnpm --recursive exec tsc --noEmit` and `pnpm --filter @prisma/cli test` are green (mount-coverage may be legitimately red mid-slice only where a dispatch's note says so).

## D1 — The compute config and `init` are gone

**Outcome:** no source, test, or mount references `prisma.compute.ts`/`.json`, `@prisma/compute-sdk/config`, `src/commands/init/`, `src/types/init.ts`, `src/lib/app/{compute-config,build-settings,deploy-framework,build}.ts`, or the `SERVICE.COMPUTE_CONFIG_*` error codes. Service commands lose the config-target positional; `resolveComputeManagementContext` and `resolveComputeTarget` are deleted; agent setup-status stops reading the config. `init` leaves the mount table, `FAMILYLESS`, and `EXPECTED_MOUNT_PATHS`; root help examples drop `init` (respelled fully in D4).

**Builds on:** clean main. **Hands to D2:** `service/target.ts` free of compute-config imports, service command files free of the positional, suites green with config tests deleted.

**Focus:** follow the import graph outward from the deleted modules; delete dependents that only served the config path (candidates: `tests/compute-config.test.ts`, `tests/service-compute-config.test.ts`, `tests/init*.test.ts`, `tests/app-build.test.ts`, e2e/`init` entries, `lib/app/bun-project.ts`/`env-config.ts` if orphaned — verify, don't assume).

## D2 — Service commands take parameters only

**Outcome:** every service command that targets an existing service accepts `--service <name>` (match by name) or `PRISMA_SERVICE_ID` (match by id, the domain-flow mechanics generalized); neither present → structured error naming `--service`, exit 2, interactive terminals included. The interactive picker, `readSelectedApp`/`setSelectedApp`/`clearSelectedApp`/`selectedByProject`, `rememberSelectedService`, and `service remove`'s selection cleanup are deleted. Branch targeting is `--branch` only: `resolveRequestedBranch`'s git inference and `lib/git/local-branch.ts` go (keep the existing non-git defaults: "main" read flows, "production" domain flow). Project resolution unchanged; `project link` keeps its picker.

**Builds on:** D1's target.ts. **Hands to D3:** parameter-only resolution with updated unit tests (picker/selection tests deleted or rewritten as missing-flag error tests), suites green.

**Focus:** `service create` doesn't resolve an existing target — keep it working. Callers using `skipSelection` (deployment-id flows) keep skipping. Check `git connect`/other importers before deleting `local-branch.ts`.

## D3 — `remove` renamed to `delete` (six commands)

**Outcome:** `project delete`, `project env delete`, `postgres delete`, `postgres connection delete`, `service delete`, `service domain delete` exist; no `remove` spelling survives for them in paths, file names, exported symbols, command ids, help, examples, next actions, error copy, consent questions, unit tests, or e2e `describeCommand` markers. `EXPECTED_MOUNT_PATHS` respelled. `git disconnect`, `auth … logout`, bucket commands untouched.

**Builds on:** D2 (service files settled). **Hands to D4:** renamed tree, suites green.

**Focus:** mechanical fan-out; grep each old spelling after the rename to prove extinction (`.drive/` history and changelog-like records exempt).

## D4 — Moves, family wrapping, group removals

**Outcome:** mount table matches the spec's acceptance tree. `postgres backup restore`, `migration ref list|set|delete`, `db migrate`, `contract format`, root `dev` and `deploy` mounted; `ref` group, `composer` group (+ brief), `build` group (`build logs`, `src/commands/build/`, its tests, e2e entries) gone; `composer destroy`/`log` not mounted. In `cli.ts`, both external families are re-wrapped with `defineCommandFamily` preserving `configSection` and `docsBaseUrl`: composer keeps only `deploy`/`dev`; ORM passes commands through but drops the `migration ref` redirect and respells the `migration apply` replacement to `{bin} db migrate --to <contract>`. No aliases or redirects for any old spelling. `EXPECTED_MOUNT_PATHS` equals the acceptance tree; group briefs updated (`postgres backup` brief now covers restore); root help examples live spellings (e.g. `auth login`, `project list`, `deploy`).

**Builds on:** D3's tree. **Hands to D5:** final grammar, mount-coverage green against the acceptance tree, suites green.

**Focus:** mount-coverage's family-completeness check runs against the wrapped families — wire `MOUNTED_FAMILIES`/`createCli` to the wrapped objects. Watch `exactOptionalPropertyTypes` when re-passing normalized `CommandRedirect`s as `RedirectSpec`s.

## D5 — String sweep, docs, process records, full verification

**Outcome:** no old spelling survives as a command reference anywhere in `packages/`, `README.md`, `docs/` (run-command next actions, help examples, error copy, comments that instruct); `tests/e2e-coverage.test.ts` exclusions/backlog respelled; README/docs command enumerations match the acceptance tree; each s2 divergence record under `.drive/projects/prisma-cli-v8/assets/s2/` gets a short entry for the renames/moves that touch it; `assets/command-review.md` is restored from commit 76a2c8a and regenerated against the new tree. Full verification per AGENTS.md: `pnpm --recursive exec tsc --noEmit`, `pnpm lint`, `pnpm --filter @prisma/cli test`, `pnpm --filter @prisma/compute test`, `pnpm --filter @prisma/cli test:e2e` (report a credential-less skip plainly).

**Builds on:** D4's final grammar; the sweep inventory appended below. **Hands to:** slice-DoD; PR-open.

## Sweep inventory (2026-08-21)

Hazards every dispatch must respect:

- `packages/cli-engine/src/execution/command-tree.ts:295` throws at `buildCli()` when a redirect's `from` collides with a mounted path. Mounting `migration ref *` while the ORM family still carries the `migration ref` redirect fails construction — the D4 family wrap (which drops that redirect) is mandatory, not cosmetic.
- `tests/e2e-coverage.test.ts` parses `src/cli.ts` as TEXT via the marker `mountedCommands: Readonly<Record<string, AnyCommand>> = {`. Keep that literal's shape when editing the mount table.
- `EXPECTED_MOUNT_PATHS` is asserted sorted; keep alphabetical order.
- No help snapshot tests exist; help is asserted by `toContain` in `tests/bin.test.ts:344-430` and `tests/orm-mount.test.ts:145-160`.

Per-spelling checklist (line numbers pre-change):

- **init:** cli.ts:32,289-292,310; commands/init/* (init.ts, settings.ts, config-file.ts, agent-setup.ts, link.ts, types.ts), types/init.ts, project/link.ts:142 (prose); mount-coverage:11,46,114; tests/init*.test.ts, compute-config.test.ts; e2e/init.e2e.ts; packages/cli/README.md:82, packages/prisma/README.md:79, docs/product/command-principles.md:31, cli-style-guide.md:61, output-conventions.md:313, error-conventions.md:274-275, docs/architecture/cli-engine-requirements.md:217.
- **project remove:** cli.ts:205; project/remove.ts; project/presentation.ts:18; mount-coverage:144; project.test.ts:115,2496; e2e/project-lifecycle.e2e.ts:211; e2e/deployed-service.ts:147,178 (comments).
- **project env remove:** cli.ts:210; project/env-remove.ts; lib/app/env-config.ts:141 (error fix copy); mount-coverage:140; project.test.ts:120,2316,2473,2490; e2e/project-lifecycle.e2e.ts:186.
- **postgres remove:** cli.ts:216; postgres/remove.ts; controllers/database.ts:143; mount-coverage:133; postgres.test.ts:145,533,1516; e2e/postgres.e2e.ts:336.
- **postgres connection remove:** cli.ts:221; postgres/connection-remove.ts (:36 usage string); mount-coverage:129; postgres.test.ts:150,2424,2472; e2e/postgres.e2e.ts:305.
- **service remove:** cli.ts:243; service/remove.ts; service/errors.ts:354,361 (why + next action); service/release.ts:39; mount-coverage:167; service-remove.test.ts; e2e/service.e2e.ts:7,127.
- **service domain remove:** cli.ts:246; service/domain-remove.ts; service/errors.ts:639 (runCommandAction); mount-coverage:160; service-domain.test.ts:524; e2e-coverage.test.ts:142 (AWAITING_COVERAGE).
- **postgres restore:** cli.ts:215; postgres/restore.ts:90,114; mount-coverage:134; postgres.test.ts:144,1182; e2e-coverage.test.ts:86 (EXCLUSIONS key); README prose (cli:76, prisma:73).
- **ref …:** cli.ts:279-281,:188 (group brief); mount-coverage:148-150; e2e-coverage:73-75; orm-mount.test.ts:145-160 (root-help group assertions incl. `ref`); cli-engine tests/redirects.test.ts:431 (synthetic fixture string — respell for coherence).
- **migrate:** cli.ts:270; mount-coverage:116; e2e-coverage:63; orm-mount.test.ts:141 (pins redirect next-action "prisma-test migrate --to <contract>" — respell to db migrate per the wrap); cli-engine redirects.test.ts + telemetry-payload.test.ts:80 (synthetic fixtures); README.md:90, cli README:81, prisma README:78, packages/cli/AGENTS.md:36; command-principles.md:38, cli-engine-requirements.md:158.
- **format:** cli.ts:265; mount-coverage:109; e2e-coverage:62; READMEs + packages/cli/AGENTS.md:36. cli-engine-requirements.md:196 already describes `contract format` (doc ahead of code — now true).
- **composer:** cli.ts:251-254,:180-182; service/presentation.ts:177 (runCommandAction "composer deploy" → "deploy"); mount-coverage:99-102,176; e2e-coverage:92-99,132; bin.test.ts:448-511; v8-conformance.test.ts:41-43,69; composer-isolation.test.ts (prose); orm-mount.test.ts:15,65; scripts/conformance.ts:34,62; README.md:31, cli README:42,80, prisma README:42,77, packages/cli/AGENTS.md:12,36; examples/*/README.md (next-smoke:22, hello-world:5 — update, they ship in-repo). The composer package's own help already says `{bin} deploy` — correct at root; nothing to change upstream.
- **build logs:** cli.ts:250,:179; commands/build/logs.ts (:101 next action, :158-160 examples); mount-coverage:98; build-logs.test.ts; e2e-coverage:128,145; cli README:79, prisma README:76, packages/cli/AGENTS.md:36.
- **README command tables:** packages/cli/README.md:70-82 and packages/prisma/README.md:67-79 are hand-duplicated — edit both.
- **Pre-existing doc bug in touched copy:** error-conventions.md:275 says `init --format json`; flag was `--config-format`. Moot once init is removed — delete the example with the command.
- **.drive/ hits:** historical records (s2 specs/design docs, parity divergence bodies, command-inventory) stay as history; only the short new divergence entries + regenerated command-review.md change.
