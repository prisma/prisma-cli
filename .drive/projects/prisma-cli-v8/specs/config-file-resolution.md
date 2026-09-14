# Finding and resolving prisma.config.ts when a repository has more than one

Status: design discussion. Nothing below is decided except where explicitly marked. This document exists so the discussion can start from the constraints and the options already explored, rather than rediscovering them.

## Background: how the config file works in the Prisma 8 CLI

`prisma.config.ts` is the Prisma 8 CLI's configuration file. It is real TypeScript that the CLI evaluates, and its default export must be wrapped in `definePrismaConfig(...)`, which stamps a version marker on the object. A `prisma.config.ts` without the marker — for example one written for Prisma 7, which uses the same filename — is rejected with a clear error rather than half-interpreted.

Every top-level key in the config object is a **section**, and each section belongs to one part of the CLI: `skills` configures the agent-skills feature today, and the ORM will have its own section. The set of section names is closed — a key the CLI does not recognise is an error, on the theory that silently ignoring settings a user wrote is worse than failing.

Today the CLI reads **exactly one file**: the one named with `--config`, otherwise `prisma.config.ts` in the directory the command runs in. It never looks anywhere else. Commands that have no config settings never read or evaluate the file at all.

## The problem

Two facts collide.

**First: commands run from subdirectories.** If the config sits at the repository root and you run a command from `apps/api/`, a current-directory-only lookup finds nothing. The CLI needs to search upward. But the moment it searches upward, a repository can have several `prisma.config.ts` files on the path between the current directory and the root — and the CLI needs a rule for which one answers.

**Second: different commands need different files.** Take this repository, which reflects the most common real-world layout:

```
acme/
  prisma.config.ts          ← deploy target, platform settings
  packages/
    db/
      prisma.config.ts      ← ORM settings (schema location, migrations)
    api/
```

The ORM's settings live in the package that owns the database code — that is the mainstream pattern, not an edge case. But `prisma deploy`, `prisma project link`, and everything Composer-related is scoped to the repository as a whole; those settings live at the root. So when you run an ORM command from `packages/db`, the right file is `packages/db/prisma.config.ts` — and when you run `prisma deploy` from that same directory, the right file is the root one.

No rule that picks **one file for everything** can satisfy both. That is the core finding of the design work so far, and the two rejected options below show each half of it failing.

## Rejected: "the highest file wins"

Rule: search upward from the current directory; the file closest to the filesystem root wins, unless a file on the way declares `root: true`, which stops the search there (like ESLint's old `root: true`).

In the example repo, every command run inside `packages/db` — including ORM commands — reads the **root** config. The ORM settings in `packages/db/prisma.config.ts` are ignored completely. The only escape is declaring `root: true` in the package's file, which then hides the root config from that package entirely — so `deploy` breaks from inside the package instead. One file, all or nothing, in either direction. This breaks the mainstream ORM layout, so it was rejected. (It was briefly implemented; see the appendix.)

## Rejected: "the nearest file wins"

Rule: search upward; the first file found wins.

Now the ORM case works: inside `packages/db`, the package's config answers. But run `prisma deploy` from `packages/db` and the CLI reads the package's config too — which has no deploy settings, and the root config that has them is never consulted. Root-scoped commands only work from the repository root. Rejected.

A third option — letting each part of the CLI declare "I am root-scoped" or "I am nearest-scoped" and searching accordingly — was rejected as redundant: where a section is *written* already encodes that, without inventing a declaration mechanism that every feature has to get right.

## Proposed (not decided): resolve per section, nearest definition wins

Rule: search upward from the current directory and collect **every** `prisma.config.ts` on the path; a file declaring `root: true` ends the collection. Then resolve each **section** independently: a section comes from the nearest file that defines it. Sections are atomic — the nearest definition wins whole; there is no merging of a section across files.

In the example repo, from inside `packages/db`:

- ORM command → the `orm` section is defined in `packages/db/prisma.config.ts` → the package's settings apply. ✓
- `prisma deploy` → the nested file has no deploy/Composer section → the search continues upward and finds it in the root file. ✓
- `skills: { check: false }` written at the root reaches `packages/db` too, because the nested file only shadows the sections it actually defines. ✓

The costs, stated plainly:

1. A command may evaluate more than one file — every config on the path up to the stopping point. Config files are executable TypeScript, so that is real user code running and a transpile per file. It is bounded by directory depth and cacheable within a run, and only commands that actually consume config trigger any of it.
2. A broken file anywhere on the path — Prisma 7 format, syntax error — fails the command with an error naming that file. The proposal is to fail early rather than skip broken files, on the theory that a half-read path is worse than an error that says exactly which file to fix.
3. The loader's result stops being "one file's contents" and becomes a resolved view over several files, and every diagnostic must say which file it is about. That is genuine engineering work in the CLI engine.

## Open questions for this discussion

- Is per-section nearest-first the right model, or is there a simpler rule that satisfies both the nested-ORM layout and root-scoped commands?
- Two files on the path define the same section: nearest silently wins, or wins with a printed notice?
- Where does the upward search stop when no file declares `root: true` — filesystem root, home directory, or a repository boundary such as the directory containing `.git`? (Under a one-file rule this mattered little; under collect-everything, every file on the path gets evaluated, so the stopping point deserves a fresh look.)
- What does `--config <file>` mean here: read only that file, or treat it as the nearest layer with the search continuing above it?
- Does the unknown-section check run per file, so a typo'd key in a nested file still errors even though the command's sections resolved elsewhere?
- Should `prisma init` scaffold a `prisma.config.ts` once this design lands, and does the `root: true` marker keep that name?

## Appendix: prior implementation, kept as reference

The "highest file wins" rule was implemented in the CLI engine and then removed when the discussion surfaced the nested-ORM problem (branch `claude/agent-skills-npm-packages-770857` in prisma/prisma-cli; commits `ba48d46` and `f72503c`, removed by `9b2f9d0` — recoverable from history). A code review of that implementation catalogued edge cases any future implementation should handle regardless of the chosen rule: resolve the search's starting directory through symlinks so errors name real paths; keep loader tests anchored so a stray config file in a real ancestor of the checkout cannot leak into them; enforce reserved-key handling on the engine side of the pluggable-loader boundary, not only inside the default loader; and name the offending value in validation errors. The full findings are in the same repository under `.drive/projects/agent-skills-npm-packages/reviews/code-review.md`, round "Init slice — Round 1".
