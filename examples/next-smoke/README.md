# Next Smoke

Manual smoke app for exercising the local source Prisma CLI from inside this repo.

This example is intentionally not part of the root pnpm workspace. Install it only when you want to run manual end-to-end checks.

This example already sets `output: "standalone"` in `next.config.ts`, which is required for Next.js deploys.

## Manual Flow

```bash
cd examples/next-smoke
pnpm install
pnpm prisma auth login
pnpm prisma project create next-smoke
pnpm prisma git connect git@github.com:OWNER/REPO.git
pnpm prisma service list
pnpm prisma service deployment list
pnpm prisma service deployment show DEPLOYMENT_ID
```

Deployments start from pushing the connected repository, the Console, or `deploy`.

What this validates:

- the CLI runs from the example directory, so config and local state resolve there
- auth can be established from inside this example before connecting a repository
- `project create` and `project link` save the local binding in `.prisma/local.json`
- pushes to the connected repository create deployments, visible via `service deployment list`
- the Next.js standalone build path deploys without extra configuration

Local files intentionally ignored in this example:

- `.prisma/`
- `prisma.config.ts`
- `node_modules/`
- `.next/`
