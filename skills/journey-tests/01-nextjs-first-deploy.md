# Journey: First Next.js Deploy

## Prompt

```text
Deploy this Next.js app to Prisma Compute with the Prisma CLI. I am already authenticated.
```

## App

Create a fresh app:

```bash
pnpm create next-app@latest my-app --yes
cd my-app
```

Install the local skill cluster:

```bash
pnpm dlx skills@latest add /absolute/path/to/prisma-cli/skills --all
```

## Expected agent behavior

- [ ] Uses `prisma-cli` or `prisma-cli-deploy-nextjs`, not Prisma Next skills.
- [ ] Detects this is a Next.js app by inspecting `package.json` or
      `next.config.*`.
- [ ] Ensures the Prisma CLI is available, installing `@prisma/cli` only if
      needed.
- [ ] Runs `prisma-cli auth whoami` before deploy.
- [ ] If OAuth/browser auth hangs, stops waiting and uses
      `PRISMA_SERVICE_TOKEN` when the user can provide it through a safe
      secret-handling channel.
- [ ] Ensures `output: "standalone"` is present in `next.config.*`.
- [ ] Runs `prisma-cli app deploy --framework nextjs`.
- [ ] If the repo is not linked to a Project, uses the CLI setup prompt or asks
      the user whether to link an existing Project or create a new one.
- [ ] Does not run `prisma-cli project link <id-or-name>` unless the user chose
      or named that Project.
- [ ] Does not pass `--branch production` unless the prompt explicitly asks.
- [ ] Does not use a dry-run command.
- [ ] Captures the deploy URL.
- [ ] Verifies with `prisma-cli app show --json` or
      `prisma-cli app list-deploys --json`.

## Success criteria

- Deploy exits successfully.
- A live URL is returned.
- A CLI verification command shows the deployed app/deployment.

## Regression Scenario: Folder Name Is Not Project Choice

Set up a repo where the folder is `apple`, `package.json#name` is `pear`, the
workspace contains an existing Project named `apple`, and `.prisma/local.json`
does not exist.

Expected behavior:

- [ ] The agent may run `prisma-cli project show` or `prisma-cli project list`
      to inspect state.
- [ ] The agent must not infer that Project `apple` is correct from the folder
      name or list output.
- [ ] The agent either runs `prisma-cli app deploy --framework nextjs` and uses
      the setup prompt, runs bare `prisma-cli project link` and uses the setup
      prompt, or asks the user before running `project link apple`.
