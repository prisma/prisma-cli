# AGENTS.md

## Verification

When changing `@prisma/compute`, run the package-local checks:

```bash
pnpm --filter @prisma/compute test
pnpm --filter @prisma/compute build
```

Keep `README.md` consumer-focused because it is included in the published npm package.
