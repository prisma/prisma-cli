---
name: prisma-cli
description: >
  Route a vague Prisma CLI, Prisma Compute, or app deployment prompt to the
  right specific skill. Use for "deploy my app to Prisma", "deploy this app",
  "set up Prisma Compute", "use prisma-cli app deploy", "help me with Prisma
  CLI", "project branch app setup", "what project should this deploy to",
  "Prisma Compute feedback", "file a Compute bug", and broad app deploy
  questions. Do not use when the prompt clearly matches Next.js deployment or
  feedback; load prisma-cli-deploy-nextjs or prisma-cli-feedback directly.
---

# Prisma CLI - Router

This skill is the front door for Prisma CLI app deploy work. It catches broad
or vague prompts and routes to the narrower workflow skill.

## When to Use

- The user asks to deploy, set up, or understand a Prisma CLI app deploy flow
  but has not named a framework or exact workflow.
- The user says "Prisma Compute" while asking about deploy, project, branch, or
  app setup.
- The user is unsure whether they are dealing with project, branch, or app
  resolution.

## When Not to Use

- The user is deploying a Next.js app or the repo clearly contains Next.js. Use
  `prisma-cli-deploy-nextjs`.
- The user wants to file a bug, feature request, feedback, or team question. Use
  `prisma-cli-feedback`.
- The user is asking for Prisma ORM commands such as `prisma generate` or
  `prisma migrate`. Those are not owned by this CLI beta.

## Routing Rules

- If the prompt says `Next.js`, `nextjs`, `next.config`, or the repo has a
  `next` dependency, load `prisma-cli-deploy-nextjs`.
- If the prompt is "deploy this app" and the framework is unknown, inspect
  `package.json` and framework config. Route to `prisma-cli-deploy-nextjs` only
  for Next.js. For other frameworks, explain that this skill cluster only
  covers Next.js in v0.
- If the user reports surprising CLI behavior, a missing deploy capability, a
  platform issue, or asks to "file this", load `prisma-cli-feedback`.
- If the user asks about project, branch, or app selection during deploy, load
  `prisma-cli-deploy-nextjs`; the CLI owns that resolution.

If no route is clear, ask one short question: "Are you trying to deploy a
Next.js app, report a Prisma CLI issue, or understand the deploy model?"

## Canonical Model

The Prisma CLI deploy flow resolves `workspace -> project -> branch -> app`.
`app deploy` is allowed to create missing project, branch, and app state when
the target is unambiguous. The agent should help the user prepare the local app,
run the CLI, and interpret the result; it should not recreate the CLI's
resolution rules in its own logic.

## Checklist

- [ ] Routed clear Next.js deploy prompts to `prisma-cli-deploy-nextjs`.
- [ ] Routed bugs, feature requests, gaps, and team questions to
      `prisma-cli-feedback`.
- [ ] Did not invent commands outside the Prisma CLI beta surface.
