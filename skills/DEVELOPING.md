# Developing Prisma CLI skills

Contributor guide for the Prisma CLI skill cluster.

## What this cluster is

This cluster teaches an LLM agent how to operate the Prisma CLI app-deploy
workflow. Each skill is workflow-scoped and is matched by the `description:`
frontmatter in its `SKILL.md`.

## Authoring rules

- Verify every CLI command, flag, error code, config key, and file path against
  this repo while writing the skill. If `rg` cannot find the surface, do not
  claim it exists.
- Keep the CLI as the owner of project, branch, and app resolution. Skills
  should guide the user and interpret CLI output, not duplicate the resolution
  algorithm.
- Use `description:` as a runtime matcher. Include phrases users actually type:
  `app deploy`, `Prisma Compute`, `deploy my app`, `Next.js`, `project`,
  `branch`, `app`, `bug`, `feedback`.
- One workflow per skill. If a workflow grows beyond one goal, split it.
- Every workflow skill must include a "What Prisma CLI doesn't do yet" section
  that names gaps honestly and routes feedback to `prisma-cli-feedback`.
- Do not add new CLI commands or flags from a skill change alone. Product
  behavior lives in `docs/product` first.

## Useful verification searches

```bash
rg "new Command\\(" packages/cli/src
rg "\\.option\\(" packages/cli/src/commands packages/cli/src/shell
rg "code: \\"" packages/cli/src docs/product
rg "app deploy" docs packages/cli/src packages/cli/tests
```

## Journey tests

Journey tests live in `skills/journey-tests/`. They are manual checklists that
install the local skill cluster into a real app, paste a real prompt into an
agent runtime, and verify the expected end state.

Add or update a journey test whenever a skill workflow changes.
