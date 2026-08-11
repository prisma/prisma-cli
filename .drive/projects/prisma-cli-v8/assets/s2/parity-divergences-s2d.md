# S2d parity divergences

Divergences introduced by the S2d work on `version` and `init`. Grows as the slice proceeds; the closing dispatch folds this, `parity-divergences-s2b.md`, the S2c list and the auth-owned `parity-divergences.md` into one document for operator sign-off.

One entry needs an explicit decision rather than a nod, and is marked **DECIDE**.

## `version` — the command does not port. RULED (operator, 2026-08-11): removed.

R-S2d-2 asked for the `version` command to be ported. It is not, and the reasoning belongs in the record because the contract said otherwise.

The engine already answers the question. `--version` is a pre-parse fast path (`settleVersion`, `packages/cli-engine/src/execution/settlement.ts`) that prints the version in human mode and emits `{"commandId":"version","result":{"version":"…"}}` in json. Legacy had the same split, and the command inventory's own note on `version` says the port should unify the two rather than carry both forward.

Nothing else the command reported survives scrutiny:

- **`invocation`** (`dev | npx | bunx | global | unknown`) had exactly one consumer in the whole codebase: the presenter that printed it. It was derived from `process.argv[1]` — the process inspecting how it was launched, which is precisely what the engine withholds argv from handlers to prevent. Restoring it would have meant piping an environment fact through the runtime to a command, and no command may reach for the environment that way.
- **node version, platform and arch** are collected for bug reports by the command that actually needs them: `controllers/feedback.ts` builds its own `{cliVersion, nodeVersion, platform, arch}` context. A separate command that prints them for a human to copy is not the mechanism.

**Consequence for R-S2d-5.** `version` becomes a ruled removal, alongside `service build`, `service deploy`, `service run` and the mock-only login flags. The grammar completeness check must exclude it, or it will report the command as missing against the inventory.

**Consequence for users.** `prisma-cli version` stops existing; `prisma-cli --version` answers instead, printing the version alone rather than a three-line card.

## `init`

### Class divergences

1. **Exit codes.** Every errored settlement exits 2. Legacy `INIT_CONFIG_EXISTS`, `INIT_CONVERT_UNSUPPORTED`, `INIT_CONVERT_INCOMPLETE` and `INIT_DETECTION_FAILED` exited 1; `COMPUTE_CONFIG_INVALID` and the usage errors already exited 2.
2. **Error codes are dotted** under `INIT.*` — see the map below.
3. **NextActions.** The legacy `fix` prose becomes one `user-choice` action; each legacy `nextSteps` string becomes a `run-command` action.
4. **Human rendering** is engine blocks rather than the legacy rail-and-card bytes. Every sentence ports verbatim.
5. **The written config path goes to stdout** in human mode. Legacy human mode wrote nothing to stdout.
6. **`warnings: string[]` becomes coded diagnostics.** The five legacy warning sentences keep their text and gain codes.

### Init-specific divergences

7. **`--format <ts|json>` is renamed `--config-format <ts|json>`.** The engine reserves `--format` globally for the output format (`RESERVED_FLAG_NAMES` in `packages/cli-engine/src/execution/shared-flags.ts`), and the legacy flag means the format of the config file it writes. Values, defaults and behaviour are unchanged, including the conversion path where an explicit `ts` over an existing `prisma.compute.json` rewrites and deletes it.
8. **`--config-format` no longer accepts `typescript`, mixed case, or surrounding whitespace.** Legacy trimmed and lower-cased the value and took `typescript` as a synonym for `ts`. The engine's enum accepts exactly `ts` and `json`; anything else is the parser's `CLI.INVALID_ARGUMENTS` rather than a `USAGE_ERROR` reading "Unknown config format".
9. **Auto-login is dropped from the link step** (R-S2d-1). Legacy reached `requireAuthenticatedAuthState`, which could open a browser sign-in on a terminal. The port reads the credential the way `auth whoami` does. Signed out, the step reports the new status `link.status: "unauthenticated"`, records `INIT.LINK_REQUIRES_SIGN_IN` at warn severity, and offers `prisma-cli auth login` as a next action. `unauthenticated` is a new value in the json result's status union.
10. **The three optional steps now default to no.** **DECIDE.** The engine has one knob where the legacy CLI had two: a preselected answer when it asks, and a separate behaviour when nobody can be asked. `prompt.confirm`'s `default` serves both, because `--yes` and non-interactive take the same branch and a handler cannot read TTY state. Defaulting install-types, link and the agent-skill offer to yes would make `init --yes` in CI run a package-manager install, call the Management API and write agent-skill files into the repo, none of which today's command does; it would also produce a spurious warning on every unattended signed-in run, because the project picker has no default. Defaulting them to no keeps unattended runs behaving exactly as they do today. **The cost:** an interactive user presses `y` rather than Enter to accept each of the three, and the prompt reads `(y/N)` where it read `(Y/n)`. One line per prompt to flip if the other trade is preferred.
11. **`declined` where the legacy said `skipped`.** Because the handler cannot tell a person's "no" from a default answer, an unattended run reports `types.status: "declined"` and `link.status: "declined"` where legacy reported `"skipped"`. Both render the same sentence; only the json result differs. `"skipped"` still means `--no-install` / `--no-link`, no `package.json`, or the JSON config format.
12. **Cancelling the install or link question aborts the run.** Legacy caught the cancel, recorded `declined` and finished at exit 0. A cancelled prompt is now the engine's `CLI.PROMPT_CANCELLED` at exit 3. A config file already written stays on disk.
13. **The agent-skill offer is suppressed in CI via `ctx.env.CI`**, following `v8/auth/agent-setup-tip.ts`; legacy suppressed it through `canPrompt`, which the handler can no longer read. **Residual gap worth review:** a non-CI run with no terminal (piped stdin) answers the offer from its default and records a dismissal in the state directory that nobody gave, which would stop a later `app deploy` offering it. Legacy neither asked nor recorded anything there.
14. **The settings preview is a commentary event, not a styled stderr block.** Same padded columns, same position — after the adjust question, before the write. The source column is no longer dimmed, it is suppressed by the log level rather than by a flag check, and under `--format json` it is a framed `message` event rather than being hidden.
15. **Step events are new stderr commentary** (`▸ write-config`, `✔ install-types`, and so on). The legacy `Installing @prisma/compute-sdk...` line is gone; the `install-types` step event replaces it.
16. **The human next steps now include the types-install command.** The legacy presenter listed only `app deploy` and `project link`, while its json `nextSteps` also carried the install command. There is now one list, and it is the json one.
17. **An invalid port typed at the adjust prompt fails the run.** Legacy passed a `validate` callback so the prompt re-asked. `prompt.text` has no validation hook, so an out-of-range answer settles as `INIT.HTTP_PORT_INVALID` (exit 2) after the framework has already been chosen.

### Error code map

| legacy | v8 |
| --- | --- |
| `INIT_CONFIG_EXISTS` | `INIT.CONFIG_EXISTS` |
| `INIT_CONVERT_UNSUPPORTED` | `INIT.CONVERT_UNSUPPORTED` |
| `INIT_CONVERT_INCOMPLETE` | `INIT.CONVERT_INCOMPLETE` |
| `INIT_DETECTION_FAILED` | `INIT.DETECTION_FAILED` |
| `COMPUTE_CONFIG_INVALID` | `INIT.COMPUTE_CONFIG_INVALID` |
| `USAGE_ERROR` (unknown config format) | `CLI.INVALID_ARGUMENTS` (engine parser) |
| `USAGE_ERROR` (`--install` with json) | `INIT.INSTALL_NOT_APPLICABLE` |
| `USAGE_ERROR` (custom framework with json) | `INIT.CUSTOM_FRAMEWORK_NEEDS_TYPESCRIPT` |
| `USAGE_ERROR` (resolution flags during conversion) | `INIT.CONVERSION_FLAGS_NOT_APPLICABLE` |
| `USAGE_ERROR` (unknown framework) | `INIT.FRAMEWORK_UNKNOWN` |
| `USAGE_ERROR` (empty `--name`) | `INIT.NAME_EMPTY` |
| `USAGE_ERROR` (bad `--http-port`) | `INIT.HTTP_PORT_INVALID` |
| `USAGE_ERROR` (unknown `--region`) | `INIT.REGION_UNKNOWN` |
| `USAGE_ERROR` (`--entry` unsupported) | `INIT.ENTRY_UNSUPPORTED` |
| warning: package.json unreadable | `INIT.TYPES_PACKAGE_JSON_UNREADABLE` (warn) |
| warning: install failed | `INIT.TYPES_INSTALL_FAILED` (warn) |
| warning: link failed | `INIT.LINK_FAILED` (warn) |
| *(no legacy equivalent)* | `INIT.LINK_REQUIRES_SIGN_IN` (warn) |
| warning: skill not installed | `INIT.AGENT_SETUP_FAILED` (warn) |

Splitting one legacy `USAGE_ERROR` into nine codes changes the json `error.code` for those failures. Every summary, why and fix sentence is preserved verbatim. Distinct codes were chosen because the engine derives a docs link per code, and one shared code across nine unrelated failures makes those links useless — but it is a machine-facing contract change.

## Two notes on the source documents

- **R-S2d-1's own summary lists steps the shipping command does not have.** It names "project name" and "env write-out" as wizard steps. Today's `init` has no project-name prompt — the app name comes from `--name`, then `package.json`, then the directory name — and writes no env file. The port follows the inventory, which R-S2d-1 itself names as the contract. A project-name prompt does exist, but inside `project link`'s create-a-Project branch, which `init` reaches only when the user picks "create a new Project".
- **`init`'s link step is now literally `project link`.** The inventory records that legacy `init` called `runProjectLink`, and `runProjectLink` is what the v8 `project link` command ports. Rather than a second picker, `project link`'s handler body is extracted as `linkDirectoryToProject` and both call it, so the two commands cannot drift.
