---
name: prisma-cli-feedback
description: >
  Hand a Prisma CLI, Prisma Compute, or app deploy question or report off to the
  team. Use for bug, bug report, file an issue, report a bug, feature request,
  missing feature, deploy failed unexpectedly, project branch app resolution bug,
  Prisma Compute feedback, app deploy feedback, platform bug, surprising
  behavior, file this, send feedback, ask the Prisma team, talk to Prisma,
  Discord, and "is this intended?" prompts.
---

# Prisma CLI - Feedback

This skill is the terminal route for Prisma CLI and Prisma Compute feedback.
Use it when a user wants a platform issue, deploy bug, missing feature, or open
question handed to the team.

Canonical channels:

- GitHub issues for bugs and concrete feature requests:
  <https://github.com/prisma/prisma-cli/issues/new/choose>
- Prisma Discord for open-ended Q&A and design discussion:
  <https://pris.ly/discord>

Never submit a public issue without explicit user confirmation.

## When to Use

- The user says "this is a bug", "file this", "send feedback", or "feature
  request".
- `app deploy`, project resolution, branch resolution, app selection, auth, env,
  logs, or deploy output behaves in a surprising way.
- A CLI command hangs or produces no useful output for about 30 seconds during
  auth, project resolution, deploy, logs, or verification.
- A Prisma CLI skill's "What Prisma CLI doesn't do yet" section routes here.
- The user wants to ask the Prisma team whether a deploy behavior is intended.

## When Not to Use

- The user wants the agent to keep deploying a Next.js app. Use
  `prisma-cli-deploy-nextjs` first, then return here only if the CLI/platform
  behavior itself appears wrong.
- The issue is in the user's application code and can be fixed locally.
- The request is about Prisma ORM commands rather than the Prisma CLI beta.

## Pick the Channel

Use a **GitHub issue** when the user has:

- a concrete bug,
- a concrete feature request,
- misleading CLI output, error code, or next step,
- a reproducible deploy, auth, project, branch, app, env, or logs problem.

Use **Discord** when the user has:

- an open-ended "is this intended?" question,
- design feedback that needs discussion before it becomes a feature request,
- a team-contact request without a concrete bug or feature.

## Issue Body

Collect the minimum public-safe context:

- Prisma CLI version: `prisma-cli version`
- Node version: `node -v`
- Package manager and version
- OS
- Exact command run
- Full output, with secrets redacted
- Whether the command hung, how long it ran, and whether interrupting it exited
  cleanly
- Auth source used: `PRISMA_SERVICE_TOKEN`, stored OAuth, or unauthenticated.
  Never print token values.
- Reachability checks, if relevant: `https://auth.prisma.io` and
  `https://api.prisma.io/v1/me`
- Whether the app is Next.js and whether `output: "standalone"` is set
- Project/branch/app names only if they are safe to share
- Expected behavior and actual behavior
- Workaround, if any

Bug title:

```text
bug(<area>): <one-line summary>
```

Feature title:

```text
feat(<area>): <one-line summary>
```

Areas: `auth`, `project`, `branch`, `app`, `deploy`, `env`, `logs`, `docs`,
`output`, `errors`, `skills`.

Bug body:

```markdown
## CLI version

<output of prisma-cli version>

## What happened?

<one-sentence summary plus relevant redacted output>

## What did you expect to happen?

<one sentence>

## Steps to reproduce

1. <step one>
2. <step two>
3. <step three>

## Environment

- Node: <version>
- OS: <platform/version>
- Package manager: <name/version>
- Framework: <Next.js/version if relevant>

## Additional context

<optional>
```

Feature body:

```markdown
## What problem are you trying to solve?

<paragraph>

## Proposed solution

<desired behavior or command shape>

## Alternatives considered

<what the user tried today>

## Scope and impact

<affected CLI command, docs, skill, or platform behavior>
```

## Submit

Show the title and body to the user first. Ask for explicit confirmation before
submitting.

Preferred submission flow:

1. Write the rendered body to a real temporary file.
2. Submit with:

```bash
gh issue create --repo prisma/prisma-cli --title "<title>" --body-file <path>
```

Do not inline the body through a heredoc or command substitution.

If `gh` is unavailable, give the user the issue URL and the rendered body.

## Discord Path

For Q&A or design feedback, give the user <https://pris.ly/discord> and draft a
short opening message:

- What they are trying to deploy or understand
- Prisma CLI version
- Relevant command/output, redacted
- The specific question

Do not auto-post to Discord.

## What Prisma CLI doesn't do yet

- **No in-product feedback command.** GitHub issues and Discord are the public
  feedback surfaces today. If the user wants `prisma-cli feedback`, file that
  as a feature request with this skill.

## Checklist

- [ ] Classified as bug, feature request, or Q&A.
- [ ] Redacted secrets and private data.
- [ ] Collected CLI version, command, output, environment, and repro.
- [ ] Showed title/body or Discord draft to the user before submission.
- [ ] Submitted only after explicit confirmation.
