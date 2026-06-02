# Journey tests

These are manual checklists for validating the Prisma CLI skill cluster against
real agent behavior.

## How to run a journey test

1. Create or check out the app named in the journey file.
2. Install the local skill cluster at the project level:

   ```bash
   pnpm dlx skills@latest add /absolute/path/to/prisma-cli/skills --all
   ```

   To test a release tag:

   ```bash
   pnpm dlx skills@latest add prisma/prisma-cli/skills#cli-v<cli-version> --all
   ```

3. Open the project in an agent runtime.
4. Paste the prompt exactly.
5. Watch what the agent does and tick each checklist item.
6. Verify the final state with the Prisma CLI.

## Journey index

| File | Skill(s) under test | Acceptance criterion |
| --- | --- | --- |
| `01-nextjs-first-deploy.md` | `prisma-cli`, `prisma-cli-deploy-nextjs` | Fresh Next.js app deploys successfully and is verified by CLI output. |
| `02-feedback-bug.md` | `prisma-cli-feedback` | Agent produces a public-safe GitHub issue body and waits for confirmation. |
