# Command grammar cleanup (slice contract)

Status: rev 1 (2026-08-21). One PR into `main`. Repo: prisma-cli only. Source: the PM command-review brief (2026-08-20/21), reproduced in the operator's message; this spec adds the grounded design decisions, not new scope. No new commands; this pass removes, renames and moves existing ones.

## At a glance

The shell owns the mount table (`packages/cli/src/cli.ts`), so most of the work is mount-table edits plus every string that names a command: help summaries, examples, `run-command` next actions, error copy, tests, docs. Four behavioural changes ride along: the compute config (`prisma.compute.ts`/`.json`) and `init` are removed outright; service commands stop using ambient context (remembered selection, interactive picker, git-branch inference); six `remove` commands become `delete`; and the composer/build groups dissolve.

## Chosen design

### 1. Compute config and `init` removal

- Delete `src/commands/init/` (all files), `src/types/init.ts`, the `init` mount, its help presence, `tests/init.test.ts`, `tests/init-agent-setup.test.ts`, and the e2e coverage entry.
- Delete `src/lib/app/compute-config.ts`, `build-settings.ts`, `deploy-framework.ts`, `build.ts`, and whatever only the config path reached (follow the import graph; `tests/compute-config.test.ts`, `tests/service-compute-config.test.ts`, `tests/app-build.test.ts` and friends go with their subjects). Drop the `@prisma/compute-sdk/config` import if nothing else needs it.
- `src/commands/service/target.ts`: delete `resolveComputeTarget`, `resolveComputeManagementContext`, the config-target positional (`[service]`) on every service command, and the `SERVICE.COMPUTE_CONFIG_INVALID` / `SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN` error codes plus their helpers (`configTargetRequiresConfigError`, `computeConfigErrorToCliError` call sites) in `service/errors.ts`.
- `src/lib/agent/setup-status.ts`: remove the compute-config read; agent status no longer depends on a config file.

### 2. Service commands take parameters only

The only ambient context a platform command may use is the directory's project link (`.prisma/local.json`).

- **Service targeting:** `--service <name>` (matched by name) or `PRISMA_SERVICE_ID` (matched by id — the existing domain-flow mechanics generalized to every service command that targets a service). Neither present → a structured error naming `--service`, exit 2, in interactive terminals too. Delete `resolveExistingServiceSelection`'s saved-selection branch and its `ctx.prompt.select` picker; delete `rememberSelectedService`, `LocalStateStore.readSelectedApp` / `setSelectedApp` / `clearSelectedApp` and the `selectedByProject` state shape (`service delete` loses its local-state cleanup with it).
- **Branch:** `--branch <name>` only; when absent, the existing non-git fallback stands (`"main"` for read flows, `"production"` for the domain flow). Delete `resolveRequestedBranch`'s git inference and `src/lib/git/local-branch.ts` + `tests/local-branch.test.ts` if nothing else imports it.
- **Project:** unchanged (`--project`, `PRISMA_PROJECT_ID`, link file). `project link` keeps its interactive picker.

### 3. `delete` destroys, `remove` detaches — renames, no aliases

`project remove`→`project delete`, `project env remove`→`project env delete`, `postgres remove`→`postgres delete`, `postgres connection remove`→`postgres connection delete`, `service remove`→`service delete`, `service domain remove`→`service domain delete`. Rename files, exported symbols, command ids, help, examples, next actions, error copy, consent questions, and tests (unit + e2e `describeCommand` markers). `git disconnect`, `auth … logout`, `bucket delete`, `bucket key delete` unchanged.

### 4. Moves

| was | is |
| --- | --- |
| `postgres restore` | `postgres backup restore` |
| `ref list` / `ref set` / `ref delete` | `migration ref list` / `set` / `delete` |
| `migrate` | `db migrate` |
| `format` | `contract format` |
| `composer dev` | `dev` |
| `composer deploy` | `deploy` |

No aliases, no redirects for old spellings; an old spelling settles the engine's unknown-command error.

**Family wrapping (the shell-side mechanism).** Both external families are re-wrapped in `cli.ts` with `defineCommandFamily`, preserving `configSection` and `docsBaseUrl`:

- **Composer:** keep only `deploy` and `dev`; `destroy` and `log` are dropped commands, and dropping them from the wrapped family is what keeps mount-coverage's "mounts every family command" check honest.
- **ORM:** commands pass through unchanged (the mount table respells their paths). Redirects are rewritten: the `migration ref` → `ref` entry is dropped (mounting it as-is would redirect a now-live spelling), and the `migration apply` entry's replacement `{bin} migrate --to <contract>` is respelled `{bin} db migrate --to <contract>`. The `migration status` flag redirects name live commands and pass through.

### 5. Removals

`composer destroy`, `composer log`, the `composer` group and its brief, and the `build` group (`build logs`, `src/commands/build/`, `tests/build-logs.test.ts`, the `build` group brief).

### 6. Housekeeping in the same PR

- `tests/mount-coverage.test.ts`: `EXPECTED_MOUNT_PATHS` becomes the acceptance tree below; `initCommand` leaves `FAMILYLESS`; the header's `init` ruling note is updated (the 2026-08-12 ruling is superseded by the 2026-08-21 PM review).
- `tests/e2e-coverage.test.ts` exclusions/backlog entries respelled; e2e `describeCommand` markers respelled; no command loses its coverage status silently.
- Root help examples (`cli.ts` `help.examples`): drop `init`; use live spellings (e.g. `auth login`, `project list`, `deploy`).
- Every `run-command` next action, help example, and error string naming an old spelling, across `packages/` (the sweep inventory in the slice plan is the checklist).
- README / docs pages that enumerate commands.
- Divergence records under `.drive/projects/prisma-cli-v8/assets/s2/` get a short entry each for the renames and moves; `assets/command-review.md` (currently only on branch `claude/command-review-divergences-17ee99`, commit 76a2c8a) is brought into this branch and regenerated against the new tree.

## Coherence rationale

One reviewer can hold this in one sitting because the change is one rule applied uniformly: the grammar moves, and every string follows. The three genuinely behavioural pieces (compute-config removal, parameter-only service targeting, family wrapping) are each small and local; the rest is mechanical renaming verified by the grammar completeness test and the full suite. It rolls back as one unit — a partial landing would leave the help, the tree, and the docs disagreeing, which is exactly what the single-PR rule prevents.

## Scope

**In:** everything above, in this repo.

**Deliberately out:** new commands (`project unlink`, `service domain list`, `bucket show`, `contract validate`, `auth token *`); the `app` → `service` control-plane API rename (CLI keeps calling `/v1/apps`); any ORM command behaviour change (only mount paths move); changes to `@prisma/composer-cli` or `@prisma/orm-toolchain` packages themselves (the shell wraps, upstream cleanups are follow-ups for those repos).

## Pre-investigated edge cases

- The ORM family ships a live redirect table (`cli.mjs`: `migration apply`, `migration ref`, three `migration status` flag entries). Mounting it unwrapped would point users at spellings this PR retires (`migrate`) or capture a spelling it revives (`migration ref`). Hence the wrap in §4.
- mount-coverage's family-completeness check fails on any family command the tree does not mount — dropping `composer destroy`/`log` therefore requires the wrapped composer family, not just mount-table deletion.
- `PRISMA_SERVICE_ID` matches by id, `--service` by name; the existing domain-flow behaviour is the model. Do not conflate them.
- `service create` names its service with a flag/argument already and does not resolve an existing target; the picker removal must not break it.
- Composer's help examples read `{bin} deploy …`; the root move makes them correct by itself. Do not "fix" them in the composer package.

## Slice-specific done conditions

- The mounted tree equals the acceptance tree below (mount-coverage green asserts it).
- `grep -rn` across `packages/`, `README.md`, `docs/` finds no remaining old spelling used as a command reference (excepting historical records: `.drive/` process artifacts, changelogs).
- Full pre-commit verification per AGENTS.md, including `pnpm --filter @prisma/cli test:e2e` (credentialed run if the env provides `PRISMA_E2E_SERVICE_TOKEN`; otherwise the suite's skip is reported, not hidden).

## Acceptance tree

```
auth         login | logout | whoami | workspace list|use|logout
project      list | show | create | link | rename | delete | transfer | env add|update|list|delete
postgres     list | show | create | usage | delete | backup list|restore | connection list|create|rotate|delete
bucket       list | create | delete | key list|create|delete
branch       list
git          connect | disconnect
service      list | create | show | open | logs | delete
             deployment list|show|promote|rollback|start|stop|delete
             domain add|show|delete|retry|wait
dev | deploy
contract     emit | infer | format
db           init | schema | sign | update | verify | migrate
migration    plan | new | list | show | status | log | graph | check | ref list|set|delete
orm          init
lsp
agent        install | update | status
telemetry    status | enable | disable
feedback
```

## References

- Brief: operator message 2026-08-21 (this spec's source of scope).
- `packages/cli/src/cli.ts` (mount table), `packages/cli/tests/mount-coverage.test.ts` (grammar check), `packages/cli/src/commands/service/target.ts` (ambient context), `packages/cli/node_modules/@prisma/orm-toolchain/dist/cli.mjs` (shipped redirect table), `@prisma/composer-cli/dist/family.mjs` (composer family shape).

## Amendment (2026-08-21, operator ruling on PR #218)

§2's `--service <name>` targeting is superseded: any command that operates on a subject resource takes that resource's identifier as its first positional argument (recorded as "Subjects are positional" in `docs/product/command-principles.md`). Concretely: `service show|open|logs|delete <service>` and `service deployment list|rollback <service>` take the service name as an optional positional (PRISMA_SERVICE_ID stays as the env fallback; neither present is still the SERVICE.TARGET_REQUIRED refusal). `service deployment promote|start|stop|delete <deployment>` and `service logs --deployment <id>` are targeted by the globally-unique deployment id alone, resolved the way `service deployment show` always was — they take no `--service`, `--project`, or `--branch`, and their results carry no `projectId`. `project show [id-or-name]` follows the same rule. Domain commands keep `--service` as a scope flag: their positional is the hostname, and the management API has no global hostname lookup.
