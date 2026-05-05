# Prisma CLI Preview

Preview npm package for the unified Prisma CLI.

Install:

```bash
pnpm add -D @prisma/cli@preview
```

Run:

```bash
pnpm prisma-cli --help
pnpm prisma-cli auth login
pnpm prisma-cli app deploy --env DATABASE_URL=postgresql://example
pnpm prisma-cli app list-env
```

The package exposes `prisma-cli` so it can coexist with the existing `prisma`
executable. If you want local project scripts that use the future command shape,
add:

```json
{
  "scripts": {
    "prisma": "prisma-cli"
  }
}
```

Then run:

```bash
pnpm prisma app deploy
```

Notes:

- This is a preview package and may change quickly.
- `prisma.config.ts` stores linked project context for this CLI.
- Environment variable values passed with `--env` are not printed back to the terminal.
