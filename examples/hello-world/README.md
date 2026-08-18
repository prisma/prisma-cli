# Hello World

Manual Bun smoke app for exercising the local source Prisma CLI from inside this repo.

This example mirrors the recommended external Bun workflow: `bun init --yes`, replace `index.ts` with a small `Bun.serve(...)` server, then wire it to a Prisma project with the CLI. Deployments start from pushing a connected repository (`git connect`), the Console, or `composer deploy` — there is no standalone deploy command.

This example is intentionally not part of the root pnpm workspace. Install it only when you want to run manual end-to-end checks.

## Manual Flow

```bash
cd examples/hello-world
pnpm install
pnpm prisma auth login
pnpm prisma project create hello-world
pnpm prisma project env add DATABASE_URL=postgresql://example --role preview
pnpm prisma project env list
pnpm prisma git connect git@github.com:OWNER/REPO.git
pnpm prisma service list
pnpm prisma service deployment list
```

Optional local run:

```bash
bun run server.ts
```

Fresh external scaffold:

```bash
mkdir my-bun-app
cd my-bun-app
bun init --yes
pnpm add -D @prisma/cli@next
```

Then replace `index.ts` with a `Bun.serve(...)` server and run:

```bash
pnpm prisma-cli auth login
pnpm prisma-cli project create my-bun-app
pnpm prisma-cli git connect git@github.com:OWNER/REPO.git
```

What this validates:

- the CLI runs from the example directory, so config and local state resolve there
- auth can be established from inside this example before connecting a repository
- `project create` and `project link` save the local binding in `.prisma/local.json`
- `project env add` can carry environment variables like `DATABASE_URL`
- `project env list` shows variable names without exposing values
- pushes to the connected repository create deployments, visible via `service deployment list`

Local files intentionally ignored in this example:

- `.prisma/`
- `prisma.config.ts`
- `node_modules/`
