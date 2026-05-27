# Prisma CLI Beta

Beta npm package for the unified Prisma CLI.

Install:

```bash
pnpm add -D @prisma/cli
```

Run:

```bash
pnpm prisma-cli --help
pnpm prisma-cli auth login
pnpm prisma-cli app deploy --env DATABASE_URL=postgresql://example
pnpm prisma-cli app list-env
```

The package exposes `prisma-cli` so it can coexist with the existing `prisma`
executable.

Notes:

- This is a beta package and may change quickly.
- `prisma.config.ts` stores linked project context for this CLI.
- Environment variable values passed with `--env` are not printed back to the terminal.
