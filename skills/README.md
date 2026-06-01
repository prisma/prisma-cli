# Prisma CLI skills

Agent skills for the Prisma CLI beta. The cluster teaches an agent how to help a
user deploy an app with `prisma-cli app deploy` without re-deriving the command
surface from docs on every run.

## What's in the box

| Skill | Scope |
| --- | --- |
| `prisma-cli` | Router for vague Prisma CLI, Prisma Compute, and app deploy prompts. |
| `prisma-cli-deploy-nextjs` | Guided Next.js deployment workflow. |
| `prisma-cli-feedback` | File CLI / Compute feedback or route open-ended team questions. |

## Install

Install the skill cluster at the project level:

```bash
pnpm dlx skills@latest add prisma/prisma-cli/skills#cli-v<cli-version> --all
```

For an in-flight branch or local checkout:

```bash
pnpm dlx skills@latest add prisma/prisma-cli/skills#main --all
pnpm dlx skills@latest add /absolute/path/to/prisma-cli/skills --all
```

Use the release tag that matches the installed `@prisma/cli` version. For a CLI
reported as `3.0.0-beta.4`, install from `#cli-v3.0.0-beta.4`.

Project-level install is intentional. Agent runtimes discover skills once the
`skills` installer materializes them into the current app repo, usually under
runtime-specific directories such as `.agents/skills/` or `.claude/skills/`.

Inside this repo, `pnpm install` runs the same wiring through the root
`prepare` script so local contributors can test the cluster immediately.

## Versioning

The skill source ships with the Prisma CLI repository and is versioned by the
same release tags as the CLI package. Keep the installed skill ref aligned with
the CLI version whose commands the skill references.

## Contributing

Read [`DEVELOPING.md`](./DEVELOPING.md) before changing a skill. The short
version: verify every command, flag, error code, and file path against the repo
while authoring, keep each skill workflow-scoped, and add a journey test for any
new or changed workflow.
