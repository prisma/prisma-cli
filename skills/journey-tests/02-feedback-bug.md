# Journey: Feedback Bug

## Prompt

```text
This Prisma Compute deploy behavior looks wrong. Can you file it with the Prisma team?
```

## Expected agent behavior

- [ ] Uses `prisma-cli-feedback`, not `prisma-next-feedback`.
- [ ] Classifies the report as bug, feature request, or Q&A.
- [ ] Collects `prisma-cli version`, Node, package manager, OS, command, and
      redacted output.
- [ ] If the report is about a hung command, records the duration, auth source,
      and endpoint reachability without printing token values.
- [ ] Redacts secrets such as `DATABASE_URL` values.
- [ ] Produces a GitHub issue title in `bug(<area>): ...` or
      `feat(<area>): ...` form when the GitHub path is chosen.
- [ ] Shows the issue body to the user before submission.
- [ ] Does not submit without explicit user confirmation.

## Success criteria

- The drafted issue is public-safe and targets `prisma/prisma-cli`.
