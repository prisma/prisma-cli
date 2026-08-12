# Survivors of the commander-shell deletion (S2d, R-S2d-4)

Every file below sits outside `src/v8/` and is reached from `src/v8/`. The list
is derived, not asserted: it is the transitive import closure of `src/v8/**`,
and after the deletion nothing outside that closure remains in `src/`.

## Where things moved

| Was | Is now | Why |
| --- | --- | --- |
| `src/shell/runtime.ts` (`CliRuntime`, `CommandContext`) | `src/legacy/runtime.ts` | The operation layer still takes a context. It now declares only the three fields it reads: `cwd`, `env`, `signal`. The commander wiring, `createCommandContext`, `canPrompt`, `stateStore`, `flags` and `ui` are gone. |
| `src/shell/output.ts` (`CliOutput`, `CommandSuccess`) | `src/legacy/output.ts` | `CommandSuccess` is still the return shape of the env-file operations. The shell's JSON and human error writers are gone. |
| `src/shell/errors.ts`, `shell/next-actions.ts`, `shell/command-arguments.ts`, `shell/cli-command.ts` | deleted | They were re-export stubs. Their real modules already lived at `src/errors.ts`, `src/next-actions.ts`, `src/command-arguments.ts`, `src/cli-command.ts`; every import was repointed there. |
| `detectDeployFramework` in `src/controllers/app.ts` | `src/lib/app/deploy-framework.ts` | v8 `init` was the only caller left, and it was pulling a 5,099-line file (and the whole prompt/UI tree behind it) for one self-contained function. |
| `src/shell/ui.ts`, `shell/global-flags.ts`, `shell/command-meta.ts`, `shell/prompt.ts`, `shell/help.ts`, `shell/command-runner.ts`, `shell/diagnostics-output.ts` | deleted | Nothing outside the shell read them once the dead command entry points went. The engine renders now. |

## Survivors that stayed where they were

### The operation layer the v8 handlers call

- `src/controllers/project.ts` — project listing, local-pin rewriting, the GitHub
  install/connect operations, transfer recipient errors.
- `src/controllers/database.ts` — database resolution, backup/usage parsing.
- `src/controllers/branch.ts` — branch listing and summaries.
- `src/controllers/app-env.ts`, `app-env-api.ts`, `app-env-file.ts` — environment
  variable scope resolution, the API row shape, and the `.env` file writers.
- `src/presenters/project.ts`, `database.ts`, `bucket.ts`, `app-env.ts`,
  `verbose-context.ts` — the `serialize*` functions v8 reuses for `--format json`.
  Every `render*` function in these files is gone: the engine draws the human
  output now.

### Auth

`src/auth/client.ts`, `credential-manager.ts`, `errors.ts`, `guard.ts`,
`legacy-state.ts`, `login.ts`, `operations.ts`, `recipient.ts`,
`service-token.ts`, `state-file.ts`, `token-storage.ts`, `workspace-name.ts`.
`src/auth/workspaces.ts` was deleted — only the legacy `auth workspace` command
used it.

### Adapters and local state

`src/adapters/git.ts`, `src/adapters/local-state.ts`, `src/state-dir.ts`.

### Feature libraries (`src/lib/**`)

`agent/{cli-command,constants,package-manager,setup-status}.ts`,
`app/{app-provider,branch-database-api,build,build-settings,bun-project,compute-config,deploy-framework,domain-guidance,env-config,env-file,env-vars,read-branch}.ts`,
`bucket/provider.ts`, `database/provider.ts`, `fs/home-path.ts`,
`git/local-branch.ts`, `project/{local-pin,provider,resolution,setup}.ts`,
`feedback.ts`, `version.ts`, `workspace-id.ts`.

Deleted from `src/lib/**` because only `app deploy` / `app run` / `app logs`
reached them: `app/{app-interaction,branch-database,branch-database-deploy,deploy-output,deploy-plan,deploy-progress,local-dev,production-deploy-gate}.ts`,
`diagnostics.ts`, `git/local-status.ts`, `project/interactive-setup.ts`.

### Shared modules at `src/`

`cli-command.ts`, `cli-name.ts`, `command-arguments.ts`, `errors.ts`,
`next-actions.ts`, `output/patterns.ts`, `update-check.ts`,
`types/{app,app-env,auth,branch,bucket,database,init,project}.ts`.

Deleted: `types/{agent,diagnostics,feedback,version}.ts` — the commands that
owned those shapes are ported and carry their own result types in `src/v8/`.
