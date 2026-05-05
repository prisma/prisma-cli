# Hello World

Manual Bun smoke app for exercising the local source Prisma CLI from inside this repo.

This example mirrors the recommended external Bun workflow: `bun init --yes`, replace `index.ts` with a small `Bun.serve(...)` server, then deploy it with the CLI.

This example is intentionally not part of the root pnpm workspace. Install it only when you want to run manual end-to-end checks.

## Manual Flow

```bash
cd examples/hello-world
pnpm install
pnpm prisma auth login
pnpm prisma app deploy --app hello-world --env DATABASE_URL=postgresql://example
pnpm prisma app list-env
pnpm prisma app list-deploys
pnpm prisma app show-deploy <deployment-id>
pnpm prisma app update-env --app hello-world --env DATABASE_URL=postgresql://another
pnpm prisma app list-env
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
pnpm add -D @prisma/cli@preview
```

Then replace `index.ts` with a `Bun.serve(...)` server and run:

```bash
pnpm prisma-cli app build
pnpm prisma-cli auth login
pnpm prisma-cli app deploy --app my-bun-app --env DATABASE_URL=postgresql://example
pnpm prisma-cli app list-env
```

What this validates:

- the CLI runs from the example directory, so config and local state resolve there
- auth can be established from inside this example before running deploy flows
- first deploy bootstraps an example-local `prisma.config.ts` when no project is linked
- first deploy can create or reuse the `hello-world` app
- first deploy can carry deploy-time environment variables like `DATABASE_URL`
- second deploy reuses saved local app selection from `.prisma/cli/state.json`
- `app list-env` shows variable names without exposing values
- the preview build flow can package and deploy a simple Bun server

Local files intentionally ignored in this example:

- `.prisma/`
- `prisma.config.ts`
- `node_modules/`
