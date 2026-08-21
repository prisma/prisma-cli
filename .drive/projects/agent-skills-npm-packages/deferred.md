# Deferred — agent-skills-npm-packages

- **When facade skill content diverges per database, split the skill by name — do not add a carrier package.** Today every facade ships an identical `prisma-8` skill and cross-package conflicts are arbitrated by highest version (`collectSkillSources`), which is safe only while content is identical and versions are lockstep. When per-database content arrives, give each facade a differently named skill (per-target skills, or a shared core plus per-target references) so names never conflict. A common or standalone skills package was considered and rejected 2026-08-21 (operator concurred): a transitive carrier is unresolvable from the project root under pnpm, and a direct-dependency skills package breaks the installed-version guarantee (facade upgraded, skills package not, check reports in sync). The allowlist still grows one deliberate line per facade either way.

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

- **Windows CI: `credential-manager.test.ts` "holds no lock while the workspace name is fetched" flaked once** (run 32477175789, 2026-08-21; expected 'Workspace A', got undefined). Pre-existing timing-sensitive test, untouched by this project; passed on rerun. A second credential-manager Windows flake followed the same day: `credential-manager-processes.test.ts` "exchanges one refresh token once when two processes refresh the same session" failed with "worker refresh failed: API request failed" (run 32497093995, 2026-08-21), on a push touching nothing near credentials. Two distinct timing-sensitive tests in this suite have now flaked on Windows; the suite needs an owner.

- **Windows CI: `skills-sync.test.ts` "does nothing and exits 0 when every copy is current" timed out once at the 5s default** (run 32474645762, 2026-08-21), with a teardown ENOTEMPTY consistent with cleanup racing the timed-out test. First run of the same code passed it; likely a slow runner. If it recurs, give the skills-sync suite a longer per-test timeout on Windows rather than chasing the race.

- **`isLikelyGlobalNpmEntrypoint` (update-check.ts:312) matches only
  `prisma-cli` paths**, so a globally-installed `prisma` user gets the
  docs-link fallback instead of a concrete update command. Pre-existing;
  newly conspicuous after the CLI_NAME → prisma rename. Origin: reviewer,
  slice 2 round 2.
