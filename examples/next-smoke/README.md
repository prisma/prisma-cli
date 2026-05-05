# Next Smoke

Manual smoke app for exercising the local source Prisma CLI from inside this repo.

This example is intentionally not part of the root pnpm workspace. Install it only when you want to run manual end-to-end checks.

This example already sets `output: "standalone"` in `next.config.ts`, which is required for Next.js deploys in the current preview.

## Manual Flow

```bash
cd examples/next-smoke
pnpm install
pnpm prisma auth login
pnpm prisma app deploy --app next-smoke
pnpm prisma app list-deploys
pnpm prisma app show-deploy <deployment-id>
pnpm prisma app deploy
pnpm prisma app deploy --app next-smoke --build-type nextjs --http-port 3000
```

What this validates:

- the CLI runs from the example directory, so config and local state resolve there
- auth can be established from inside this example before running deploy flows
- first deploy bootstraps an example-local `prisma.config.ts` when no project is linked
- first deploy can create or reuse the `next-smoke` app
- first deploy uses the Next.js standalone build path without needing `--http-port`
- `--build-type nextjs --http-port 3000` is available as an explicit repair or override path
- second deploy reuses saved local app selection from `.prisma/cli/state.json`

Local files intentionally ignored in this example:

- `.prisma/`
- `prisma.config.ts`
- `node_modules/`
- `.next/`
