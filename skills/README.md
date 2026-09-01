# Prisma Platform skills

Agent skills for the [Prisma CLI](https://github.com/prisma/prisma-cli): one
`SKILL.md` that teaches an LLM agent the Prisma Platform's resource model
without re-deriving it from documentation each time.

## What's in the box

One skill, `prisma-platform-core-concepts`, covering the platform: the
workspace/project/branch model, preview environments, the two deploy paths
(GitHub integration and `prisma deploy`), services and versions, the Compute
runtime, Prisma Postgres, object storage, environment variables, the local
development stack, and the failure modes. The ORM and Composer have their own
core-concepts skills that ship inside their own packages; this one owns
everything platform-side.

## Install

The skill ships inside the `prisma` tarball, so installing the package is
what brings it in. `prisma skills sync` copies it out of `node_modules` into
the skill directories the agent runtimes read (`.claude/skills/`,
`.cursor/skills/`, `.agents/skills/`, `.devin/skills/`):

```bash
pnpm add -D prisma
pnpm prisma skills sync
```

`prisma init` wires a `postinstall` hook so an upgrade brings the matching
skill with it. The version you read is then always the version you
installed: the skill's frontmatter carries `metadata.library: "prisma"` and a
`metadata.library_version` stamped by the release that built the tarball
([`scripts/set-version.ts`](../scripts/set-version.ts);
[`scripts/check-skill-packaging.mjs`](../scripts/check-skill-packaging.mjs)
proves it against the packed artifact).

## Authoring rules

For anyone editing the skill:

1. **Verify every claim while drafting, not in a final pass.** Every command
   and flag must exist in `packages/cli/src/` (the `mountedCommands` map in
   `cli.ts` is the source of truth for what mounts where). If a search finds
   nothing, the surface doesn't ship: name it under *What the platform
   doesn't do yet* instead of extrapolating.
2. **The skill must be self-contained.** It gets installed into other repos,
   so no link may resolve outside `skills/prisma-platform-core-concepts/`.
   Repo docs may be named in prose, never linked relatively.
3. **Teach concepts, not procedures.** Name the moving parts and the command
   that reveals each piece of state; reserve numbered steps for
   one-safe-path operations.
4. **Leave the `metadata` stamp alone.** `metadata.library` names the npm
   package the skill ships inside, and `metadata.library_version` is
   rewritten by [`scripts/set-version.ts`](../scripts/set-version.ts) on
   every release. Hand-editing the version, or dropping either key, breaks
   the release script and
   [`scripts/check-skill-packaging.mjs`](../scripts/check-skill-packaging.mjs).
   They live under `metadata` because the Agent Skills spec
   (agentskills.io) defines the top-level keys and reserves that map
   (string → string) for publisher extensions. A new skill needs both keys,
   with any placeholder version.
5. **Folder name and frontmatter `name` must match.** The runtimes key on
   the frontmatter, humans on the folder.

Maintainer-facing skills (release process and similar) live in
[`../skills-contrib/`](../skills-contrib/), not here.
