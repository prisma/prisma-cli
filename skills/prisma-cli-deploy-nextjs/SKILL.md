---
name: prisma-cli-deploy-nextjs
description: >
  Help an agent deploy a Next.js app with Prisma CLI and Prisma Compute. Use for
  "deploy this Next.js app", "deploy my Next app to Prisma", "prisma-cli app
  deploy nextjs", "Prisma Compute Next.js deploy", "set up project branch app
  for a Next.js app", "Next.js standalone deploy", and first-time app deploy
  prompts after auth. Covers CLI install checks, auth, Next.js standalone
  output, project/branch/app resolution, deploy verification, logs, and routing
  deploy gaps to prisma-cli-feedback.
---

# Prisma CLI - Deploy a Next.js App

Use this skill when the user wants an agent-guided Next.js deploy with the
Prisma CLI beta.

## When to Use

- The current repo is a Next.js app or has a `next` dependency.
- The user asks to deploy a Next.js app to Prisma, Prisma Compute, or with
  `prisma-cli app deploy`.
- The user has authenticated and wants the agent to complete first deploy.

## When Not to Use

- The app is Hono, TanStack Start, Astro, Nuxt, Bun-only, or another framework.
  The CLI may support some of these, but this v0 skill is only the Next.js path.
- The user wants to file a bug, feature request, or platform feedback. Use
  `prisma-cli-feedback`.
- The user is asking for Prisma ORM migration or client generation help.

## Key Concepts

- **The CLI owns target resolution.** `prisma-cli app deploy` resolves or
  creates Project setup, Branch, and App state. Prefer the bare command for a
  fresh deploy; add `--project`, `--branch`, or `--app` only when the user asks
  for a specific target or the CLI reports ambiguity.
- **Project setup is a user choice.** `project show` and `project list` expose
  state and candidates; they do not select a Project. Do not link from folder
  name, package name, or a plausible list match. Use `prisma-cli app deploy` to
  enter setup, or use bare `prisma-cli project link` when the user wants to
  connect the repo first.
- **First deploy binds the directory.** Successful project binding writes local
  `.prisma/` state. Treat that as local CLI state, not committed app config.
- **Next.js deploy uses standalone output today.** If the app does not already
  set `output: "standalone"` in `next.config.*`, add it before deploy using the
  smallest edit that preserves the existing config.
- **Headless auth has a first-class path.** `PRISMA_SERVICE_TOKEN` is the
  preferred auth source for CI and agent-run deploys. Use it when OAuth or a
  browser callback is unavailable, but never ask the user to paste the token
  into chat.
- **Silent commands are a signal.** If `auth whoami`, `auth login`, or
  `app deploy` produces no useful output for about 30 seconds, stop the command,
  report that auth/API communication appears stalled, and move to diagnostics
  instead of waiting indefinitely.
- **Verification is a CLI step.** After deploy, verify with the returned URL and
  an introspection command such as `prisma-cli app show --json` or
  `prisma-cli app list-deploys --json`.

## Workflow

### 1. Confirm the local app

Inspect `package.json` and `next.config.*`.

- If `next` is missing, stop and explain that this skill only covers Next.js.
- If `@prisma/cli` is missing, install it as a dev dependency with the user's
  package manager, or run via `pnpm dlx @prisma/cli` / `npx prisma-cli` when the
  user does not want a dependency.
- Check the CLI with:

```bash
prisma-cli version
```

If the project uses a package-manager script such as `pnpm prisma-cli`, use that
form consistently.

### 2. Confirm auth

Ask the CLI for state:

```bash
prisma-cli auth whoami
```

If `PRISMA_SERVICE_TOKEN` is already set in the command environment, keep using
that environment for deploy and verification. If the user is signed out, run:

```bash
prisma-cli auth login
```

If the browser/OAuth path hangs or cannot be used, ask the user to provide a
service token through their normal secret-handling channel, for example by
exporting `PRISMA_SERVICE_TOKEN` in the shell used for the deploy command. Do
not fabricate tokens or ask the user to paste credentials into chat.

If auth commands hang, collect the command, duration, CLI version, token source
(`PRISMA_SERVICE_TOKEN` versus stored OAuth, without printing token values), and
whether `https://auth.prisma.io` and `https://api.prisma.io/v1/me` are reachable,
then route the finding to `prisma-cli-feedback`.

### 3. Prepare Next.js standalone output

Check `next.config.js`, `next.config.mjs`, `next.config.cjs`, or
`next.config.ts`.

- If it already contains `output: "standalone"`, leave it alone.
- If a config exists without standalone output, add `output: "standalone"` to
  the exported config object.
- If there is no config file, create the smallest `next.config.ts` or
  `next.config.mjs` that sets standalone output, matching the app's module style
  where obvious.

### 4. Deploy

For a first deploy from an unlinked repo, prefer:

```bash
prisma-cli app deploy --framework nextjs
```

If the user explicitly wants to link the repo before deploying, run the
interactive setup primitive:

```bash
prisma-cli project link
```

Use explicit flags only when they express user intent or repair ambiguity:

```bash
prisma-cli app deploy --project <id-or-name> --app <name> --branch <name> --framework nextjs
```

Only run `prisma-cli project link <id-or-name>` after the user named or chose
that Project. Only run `prisma-cli project create <name>` or
`prisma-cli app deploy --create-project <name>` after the user confirmed the new
Project name.

Do not use `--branch production` for a first deploy unless the user explicitly
asks for production. The default remote deploy path is preview-oriented.

### 5. Verify

Capture the deploy URL from the success output, then verify with the CLI:

```bash
prisma-cli app show --json
prisma-cli app list-deploys --json
```

If the deploy succeeded but the app does not respond, inspect logs:

```bash
prisma-cli app logs
```

When reporting success to the user, include the URL, project/app/branch if the
CLI showed them, and the verification command that passed.

## Common Pitfalls

- Do not add a dry-run step. The current CLI does not expose a deploy dry run.
- Do not duplicate project, branch, or app resolution in the agent. Let the CLI
  decide, then interpret its output.
- Do not run `project link <id-or-name>` just because a listed Project looks
  plausible. Ask the user or use the CLI setup picker first.
- Do not print secret values from `--env`, `.env`, or platform env commands.
- Do not silently retarget production. Production requires explicit intent.
- Do not continue with another framework under this skill; route unsupported
  framework needs to `prisma-cli-feedback`.

## What Prisma CLI doesn't do yet

- **No in-CLI skill installer.** Install this cluster with `skills add` at the
  project level.
- **No deploy dry run.** Use the normal deploy flow and verify afterward.
- **This skill is Next.js-only.** Hono and TanStack Start need follow-up skills.

Route requests for those gaps to `prisma-cli-feedback`.

## Reference Files

- `docs/product/command-spec.md`
- `docs/product/resource-model.md`
- `docs/product/error-conventions.md`
- `examples/next-smoke/README.md`

## Checklist

- [ ] Confirmed this is a Next.js app.
- [ ] Confirmed `@prisma/cli` / `prisma-cli` is available.
- [ ] Confirmed auth with `prisma-cli auth whoami` or completed login.
- [ ] Ensured `output: "standalone"` is present in Next.js config.
- [ ] Did not link or create a Project unless the user explicitly chose the
      Project or confirmed the new Project name.
- [ ] Ran `prisma-cli app deploy --framework nextjs`.
- [ ] Verified success with URL plus `app show --json` or `app list-deploys --json`.
- [ ] Routed CLI/platform gaps to `prisma-cli-feedback`.
