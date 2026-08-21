# Brief: command grammar cleanup (post PM review, 2026-08-21)

Outcome of the command review with product (2026-08-20/21). One PR against `prisma-cli` `main`. No new commands are built; this pass removes, renames and moves existing ones. The shell owns the mount table (`packages/cli/src/cli.ts`), so most moves are mount-table edits plus the strings that name the commands (help summaries, examples, `run-command` next actions, error copy, tests).

## 1. Remove the compute config and `init`

`prisma.compute.ts` / `prisma.compute.json` is deprecated and unsupported. Remove every trace:

- `init` is removed entirely (the command, its help, its tests, `src/commands/init/`, `src/types/init.ts`). `project link` and `project create` already cover directory linking.
- The service commands stop reading the config: delete `loadComputeConfig` usage in `src/commands/service/target.ts`, the config-target positional (`[service]`) on every service command, `resolveComputeManagementContext`, and the `SERVICE.COMPUTE_CONFIG_INVALID` / `SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN` error codes.
- The agent setup-status read of the config (`src/lib/agent/setup-status.ts`) goes; agent status no longer depends on a config file.
- Delete `src/lib/app/compute-config.ts`, `build-settings.ts`, `deploy-framework.ts`, `build.ts` and whatever else only the config path reached. Drop the `@prisma/compute-sdk/config` import if nothing else needs it.

## 2. Service commands take parameters only

The only ambient context a platform command may use is the directory's project link (`.prisma/local.json`). Everything else comes from flags or env vars.

- **Service:** `--service <name>` or `PRISMA_SERVICE_ID`. Missing → a structured error naming the flag (exit 2), in interactive terminals too. Remove the remembered selection (`readSelectedApp` / `setSelectedApp` / `rememberSelectedService`) and the interactive picker (`ctx.prompt.select` over services in `target.ts`). `service remove`'s local-state cleanup of the selection goes with it.
- **Branch:** `--branch <name>` only. Remove the current-git-branch inference (`resolveRequestedBranch` / `readLocalGitBranch` in `target.ts`).
- **Project:** unchanged — `--project`, env override, then the link file.

`project link` keeps its interactive project picker; that command exists to establish the link.

## 3. Verbs: `delete` destroys, `remove` detaches

Rename these commands (paths, ids, help, examples, next actions, error copy, consent questions, tests) — no aliases:

| was | is |
| --- | --- |
| `project remove` | `project delete` |
| `project env remove` | `project env delete` |
| `postgres remove` | `postgres delete` |
| `postgres connection remove` | `postgres connection delete` |
| `service remove` | `service delete` |
| `service domain remove` | `service domain delete` |

`git disconnect` and `auth … logout` are unchanged. `bucket delete` / `bucket key delete` already conform.

## 4. Moves

| was | is | notes |
| --- | --- | --- |
| `postgres restore` | `postgres backup restore` | restore acts on a backup |
| `ref list` / `ref set` / `ref delete` | `migration ref list` / `set` / `delete` | the `ref` group disappears |
| `migrate` | `db migrate` | |
| `format` | `contract format` | |
| `composer dev` | `dev` | root-level |
| `composer deploy` | `deploy` | root-level |

No aliases and no redirects for the old spellings (pre-rc, no compatibility debt — the same rule the deployment subgroup followed). An old spelling settles the engine's unknown-command error. For the ORM moves this reverses `prisma-next`'s own retirement of `migration ref` in favour of top-level `ref`; its shipped redirect table (which points `migration ref` → `ref`) must not be mounted as-is — drop or invert those entries.

Moving `dev` / `deploy` to the root fixes Composer's known help-example defect by itself: its examples read `{bin} deploy …`, which becomes correct.

## 5. Removals

- `composer destroy` — dropped.
- `composer log` — dropped (`dev` streams the same local output in the foreground).
- The `composer` group — gone once `dev` and `deploy` are at the root; remove its group brief.
- The `build` group (`build logs`) — the platform build runner is deprecated.

## 6. Housekeeping that must land in the same PR

- The grammar completeness test (`packages/cli/tests/mount-coverage.test.ts`) and any published command list / README / docs pages that enumerate commands.
- Root help examples (`init` is currently the first example).
- Every `run-command` next action and help example that names a moved or renamed command; grep for each old spelling across `packages/`.
- The divergence records under `.drive/projects/prisma-cli-v8/assets/s2/` get a short entry each for the renames and moves; the command review (`assets/command-review.md`) gets regenerated.

## Out of scope

- New commands (`project unlink`, `service domain list`, `bucket show`, `contract validate`, `auth token *`) — deferred by product; do not build.
- The `app` → `service` API rename — separate brief for the control-plane repo; the CLI keeps calling `/v1/apps` for now.
- Any change to the ORM commands' behaviour; only their mount paths move.

## Resulting tree (acceptance)

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
