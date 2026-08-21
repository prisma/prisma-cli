# Deferred — agent-skills-npm-packages

- **Retire or re-scope the `agent` command group in prisma-cli.**
  `prisma agent install|update|status` still installs the v6/v7-line
  skills by shelling out to `npx skills@latest add prisma/skills`, and
  its group brief ("Manage Prisma skills for AI coding agents") now
  overlaps the new `skills` group. Slice 2 flagged it; out of slice
  scope, but the overlap should be decided before the release that
  ships `prisma skills`. Origin: slice 2 implementer report, 2026-08-21.

- **Composer website hero copy.** Slice 4 changed `website/src/template.ts`'s
  hero from `npx skills add prisma/composer` to
  `pnpm add @prisma/composer prisma && pnpm prisma skills sync` — reverted
  out of the PR on review advice (product copy, deploys immediately from
  the repo, and the new command doesn't exist on npm until prisma-cli
  ships). Needs the site owner's wording + release-timing decision.
- **`check-skill-packaging.mjs` hardcodes `@prisma/composer`** while
  `stage-skills.mjs` is generic; a second skill-bearing composer package
  would be staged but never verified. Generalize when a second package
  appears.

- **Turbo race: `pnpm test` can rebuild `cli-engine` dist while `cli` tests
  import it** (`Failed to resolve entry for package "@prisma/cli-engine"`,
  intermittent). Fix: a `dependsOn` on the engine's build in turbo.json.
  Origin: slice 2 implementer, 2026-08-21.

- **Windows CI: `skills-sync.test.ts` "does nothing and exits 0 when every copy is current" timed out once at the 5s default** (run 32474645762, 2026-08-21), with a teardown ENOTEMPTY consistent with cleanup racing the timed-out test. First run of the same code passed it; likely a slow runner. If it recurs, give the skills-sync suite a longer per-test timeout on Windows rather than chasing the race.

- **`isLikelyGlobalNpmEntrypoint` (update-check.ts:312) matches only
  `prisma-cli` paths**, so a globally-installed `prisma` user gets the
  docs-link fallback instead of a concrete update command. Pre-existing;
  newly conspicuous after the CLI_NAME → prisma rename. Origin: reviewer,
  slice 2 round 2.
