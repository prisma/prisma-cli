# S2d parity divergences

Divergences introduced by the S2d port of `version` and `init`. Grows as the slice proceeds; the closing dispatch folds this, `parity-divergences-s2b.md`, the S2c list and the auth-owned `parity-divergences.md` into one document for operator sign-off.

Two entries need an explicit decision rather than a nod, and are marked **DECIDE**.

## `version`

1. **The invocation kind is gone.** The legacy result carried `invocation`, one of `dev | npx | bunx | global | unknown`, and `detectInvocation` derived it mostly from `process.argv[1]`. Handlers cannot read argv on the engine — the runtime owns it and does not pass it on. Deriving it from environment variables alone still answers for npx and bunx but reports `unknown` where the legacy command reported `global`, so the field is dropped rather than made intermittently wrong. R-S2d-2 and the handover brief both name only version, node and platform. **DECIDE:** ratify the drop, or rule that the runtime exposes the invocation so the field can return.
2. **Human mode writes the fields to stdout.** Legacy wrote the card to stderr and nothing to stdout. The engine's ported commands present a machine-readable stdout payload alongside the human card, which is what makes the output pipeable; `auth whoami` already behaves this way.
3. **`VERSION_UNAVAILABLE` becomes `VERSION.UNAVAILABLE`**, exit 2 rather than exit 1, as a structured error rather than the legacy shell's `CliError`.

## `init`

### Class divergences

4. **Exit codes.** Every errored settlement exits 2. Legacy `INIT_CONFIG_EXISTS`, `INIT_CONVERT_UNSUPPORTED`, `INIT_CONVERT_INCOMPLETE` and `INIT_DETECTION_FAILED` exited 1; `COMPUTE_CONFIG_INVALID` and the usage errors already exited 2.
5. **Error codes are dotted** under `INIT.*` — see the map below.
6. **NextActions.** The legacy `fix` prose becomes one `user-choice` action; each legacy `nextSteps` string becomes a `run-command` action.
7. **Human rendering** is engine blocks rather than the legacy rail-and-card bytes. Every sentence ports verbatim.
8. **The written config path goes to stdout** in human mode. Legacy human mode wrote nothing to stdout.
9. **`warnings: string[]` becomes coded diagnostics.** The five legacy warning sentences keep their text and gain codes.

### Init-specific divergences

10. **`--format <ts|json>` is renamed `--config-format <ts|json>`.** The engine reserves `--format` globally for the output format (`RESERVED_FLAG_NAMES` in `packages/cli-engine/src/execution/shared-flags.ts`), and the legacy flag means the format of the config file it writes. Values, defaults and behaviour are unchanged, including the conversion path where an explicit `ts` over an existing `prisma.compute.json` rewrites and deletes it.
11. **`--config-format` no longer accepts `typescript`, mixed case, or surrounding whitespace.** Legacy trimmed and lower-cased the value and took `typescript` as a synonym for `ts`. The engine's enum accepts exactly `ts` and `json`; anything else is the parser's `CLI.INVALID_ARGUMENTS` rather than a `USAGE_ERROR` reading "Unknown config format".
12. **Auto-login is dropped from the link step** (R-S2d-1). Legacy reached `requireAuthenticatedAuthState`, which could open a browser sign-in on a terminal. The port reads the credential the way `auth whoami` does. Signed out, the step reports the new status `link.status: "unauthenticated"`, records `INIT.LINK_REQUIRES_SIGN_IN` at warn severity, and offers `prisma-cli auth login` as a next action. `unauthenticated` is a new value in the json result's status union.
13. **The three optional steps now default to no.** **DECIDE.** The engine has one knob where the legacy CLI had two: a preselected answer when it asks, and a separate behaviour when nobody can be asked. `prompt.confirm`'s `default` serves both, because `--yes` and non-interactive take the same branch and a handler cannot read TTY state. Defaulting install-types, link and the agent-skill offer to yes would make `init --yes` in CI run a package-manager install, call the Management API and write agent-skill files into the repo, none of which today's command does; it would also produce a spurious warning on every unattended signed-in run, because the project picker has no default. Defaulting them to no keeps unattended runs behaving exactly as they do today. **The cost:** an interactive user presses `y` rather than Enter to accept each of the three, and the prompt reads `(y/N)` where it read `(Y/n)`. One line per prompt to flip if the other trade is preferred.
14. **`declined` where the legacy said `skipped`.** Because the handler cannot tell a person's "no" from a default answer, an unattended run reports `types.status: "declined"` and `link.status: "declined"` where legacy reported `"skipped"`. Both render the same sentence; only the json result differs. `"skipped"` still means `--no-install` / `--no-link`, no `package.json`, or the JSON config format.
15. **Cancelling the install or link question aborts the run.** Legacy caught the cancel, recorded `declined` and finished at exit 0. A cancelled prompt is now the engine's `CLI.PROMPT_CANCELLED` at exit 3. A config file already written stays on disk.
16. **The agent-skill offer is suppressed in CI via `ctx.env.CI`**, following `v8/auth/agent-setup-tip.ts`; legacy suppressed it through `canPrompt`, which the handler can no longer read. **Residual gap worth review:** a non-CI run with no terminal (piped stdin) answers the offer from its default and records a dismissal in the state directory that nobody gave, which would stop a later `app deploy` offering it. Legacy neither asked nor recorded anything there.
17. **The settings preview is a commentary event, not a styled stderr block.** Same padded columns, same position — after the adjust question, before the write. The source column is no longer dimmed, it is suppressed by the log level rather than by a flag check, and under `--format json` it is a framed `message` event rather than being hidden.
18. **Step events are new stderr commentary** (`▸ write-config`, `✔ install-types`, and so on). The legacy `Installing @prisma/compute-sdk...` line is gone; the `install-types` step event replaces it.
19. **The human next steps now include the types-install command.** The legacy presenter listed only `app deploy` and `project link`, while its json `nextSteps` also carried the install command. There is now one list, and it is the json one.
20. **An invalid port typed at the adjust prompt fails the run.** Legacy passed a `validate` callback so the prompt re-asked. `prompt.text` has no validation hook, so an out-of-range answer settles as `INIT.HTTP_PORT_INVALID` (exit 2) after the framework has already been chosen.

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
