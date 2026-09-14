# Handover: `--format markdown` and the engine 0.4.0 release chain

Written 2026-09-14 for a fresh agent in a fresh worktree. Everything described here is merged and published; nothing is in flight. Read this file, then the transcript, before doing anything.

## Where the context is

- **Transcript of the session that did all of this:** `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-prisma-cli--claude-worktrees-s2b-resources-handover-5be347/c221ff46-7684-469b-9729-1a799e1cf180.jsonl` (3.6 MB JSONL). It holds the design discussion with Will, every ruling, the four-dispatch build loop with its review rounds, the PR review round, the QA run, and the three-repo release chain. Grep it for `[ok]`, `Pinned during`, `engine-pin-mismatch`, or a PR number to jump to a moment.
- **Slice contract:** `.drive/projects/prisma-cli-v8/specs/markdown-format.md`. Every rendering rule, the rulings made during the build (`Pinned during D1`, `Pinned during D3`, `Pinned from PR review`), and the accepted stderr exceptions.
- **Dispatch plan:** `.drive/projects/prisma-cli-v8/plans/markdown-format.md`.
- **Release chain plan with outcomes:** `.drive/projects/prisma-cli-v8/plans/engine-040-chain.md`.
- **Review record:** `.drive/projects/prisma-cli-v8/reviews/code-review.md`, section `# Markdown format — code review`.
- **Memory:** `~/.claude/projects/-Users-wmadden-Projects-prisma-prisma-cli/memory/engine-040-transition.md` (the reusable chain order) and `engine-030-release-chain.md` (corrected: the engine still publishes under `dev`).

## What shipped

`@prisma/cli-engine@0.4.0` adds a third output format, `--format markdown`: the blocks a command already describes for the terminal, rendered as plain Markdown, everything on stdout, nothing on stderr from the engine, colour off, only ever explicit (no shorthand flag, no auto-detection; terminals still get `human`, pipes still get `json`). Help, errors, diagnostics, next actions, config warnings, `--version`, child status, and live events all have pinned shapes. The terminal renderer is byte-identical to before (help was split into a data model plus two renderers). One behaviour change outside markdown: `prisma project --json` prints group help and exits 0 instead of failing as an unknown command.

Merged PRs, in order:

| Repo | PR | What |
| --- | --- | --- |
| prisma/prisma-cli | #260 | The format, engine 0.3.0 → 0.4.0, two conformance `PinException` entries carrying the transition |
| prisma/orm | #30272 | ORM 8.0.0-rc.11, every engine pin to 0.4.0, release notes, rc.10→rc.11 upgrade recipes |
| prisma/composer | #293, #294 | ORM family to rc.11 and engine to 0.4.0; release v0.20.0 |
| prisma/prisma-cli | #265, #266 | Product pins (composer-cli 0.20.0, orm-toolchain rc.11); release 8.0.0-rc.15 with `exceptions: []` restored |

Verified 2026-09-14 from a clean npm cache: `npx prisma@8.0.0-rc.15` installs exactly one engine copy (0.4.0), and `--format markdown` works on help and commands.

## Open follow-up work, in priority order

1. **Point the agent skills at the new format.** Nothing does yet. `skills/prisma-platform-core-concepts/SKILL.md` here has one `--json` reference; prisma/orm's `skills/prisma-8/references/{debug,migrations,migration-review}.md` have about twenty. Swap to `--format markdown` where an agent reads the output itself; keep `--json` where a script parses it. One PR per repo. This is the adoption lever.
2. **Docs site.** prisma/web `apps/docs/content/docs/cli/*.mdx` describe `--json` and `--format human|json` and do not know about markdown.
3. **Engine `latest` dist-tag.** `@prisma/cli-engine` `latest` is still 0.3.0; 0.4.0 sits under `dev`. Cause: the publish workflow's dev half publishes the engine with `--tag dev`, and the release half skips an already-published version without retagging; OIDC cannot run `npm dist-tag add`. Will owns the hand move `npm dist-tag add @prisma/cli-engine@0.4.0 latest`. The permanent fix is prisma-cli#240 (approved 2026-08-26, never merged, needs a rebase). Rebase it and bring it to green if Will says so.
4. **Two loose ends in the format, after real use.** The update notice and the skills-out-of-date notice (`packages/cli/src/update-check.ts`, `skills-check.ts`) still print on stderr under markdown (accepted in the spec, the one break in the everything-on-stdout rule). A next action's `reason` field is not rendered, mirroring the terminal; agents are the one reader who would use it.
5. **Housekeeping.** Merged worktrees to remove: `~/Projects/prisma/release-8.0.0-rc.11` (prisma/orm), `~/Projects/prisma/composer/.claude/worktrees/{engine-0-4-0,release-0-20-0}`, and in this repo `.claude/worktrees/{release-8.0.0-rc.15,s2b-resources-handover-5be347}`.

## How the work was run, so the next piece follows the same shape

- Drive process: slice in project `prisma-cli-v8`; orchestrator writes spec and plan, a persistent Fable implementer builds one dispatch at a time, a persistent Opus reviewer verifies each against the spec with exact-bytes tests, then PR from the bot account (`wmadden-electric`, remote `bot`, commits `-s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` plus the Co-Authored-By line). Will approves and merges; he does not want questions through the question UI, and every design call is his.
- The next engine bump repeats the chain in `engine-040-transition.md`: carry the PR with two `PinException`s; prisma/orm release via its `publish-npm-version` skill with engine pins moved and upgrade recipes; composer pins PR then `bump-minor` release; then `gh workflow run update-product-versions.yml` here (opens the pins PR, auto-merges on CodeRabbit's approval) and a release PR that empties the exceptions.
- Gotchas met: `pnpm --filter @repo/cli-conformance test` (the package is `@repo`, not `@prisma`); engine tests import from `dist`, so build before running one file; prisma/prisma redirects to prisma/orm; composer's deploy-verify-destroy CI job can fail on a Prisma API transport error and pass on rerun; it is not a required check.
