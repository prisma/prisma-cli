# Code review — agent-skills-npm-packages

## Subagent IDs

| Role | Slice | Agent | Status |
| --- | --- | --- | --- |
| Implementer (prisma/prisma) | 1, 3 | spawned (persistent; ID held by orchestrator) | running slice 1 |
| Implementer (prisma-cli) | 2 | spawned (persistent; ID held by orchestrator) | running slice 2 |
| Implementer (composer) | 4 | spawned (persistent; ID held by orchestrator) | running slice 4 |
| Reviewer | all | — | not yet spawned |

Orchestrator note: three per-repo persistent implementers instead of the
canonical single implementer — slices 1/2/4 run parallel in disjoint
repos. Reviewer is single and sequential. Reviewer model: standing rule
asks Opus-4.8-mid; unavailable in this session, using Opus.

## Scoreboard

| Slice | Round | Verdict |
| --- | --- | --- |
| Slice 4 | Round 1 | ESCALATING TO USER — review artifact missing (branch and clone gone) — RESOLVED, see round note; real round 1 pending |
| Slice 2 | Round 1 | ANOTHER ROUND NEEDED |
| Slice 4 | Round 1 (real) | ANOTHER ROUND NEEDED |
| Slice 4 | Round 2 | SATISFIED (slice scope) — DO NOT MERGE until slice 2's parser and plan.md are amended; see note |
| Slice 1 | Round 1 | ANOTHER ROUND NEEDED |
| Slice 3 | Round 1 | ANOTHER ROUND NEEDED |
| Slice 2 | Round 2 | ANOTHER ROUND NEEDED (both round-1 findings fixed; two new, both small) |
| Slice 2 | Round 3 | ANOTHER ROUND NEEDED (R2 findings fixed; S2-R2-1 premise corrected — reviewer error; two further sweep residues) |

## Findings log

### S4-R1-1 — blocker — `.refs/composer` (entire clone), branch `skill-in-tarball`

The code under review does not exist on this machine. The slice-4 spec
places the work in `.refs/composer` on branch `skill-in-tarball`. At
review time `.refs/` contains only `prisma`; there is no composer clone
anywhere on the filesystem carrying that branch.

Evidence:

- `/Users/will/Projects/prisma/prisma-cli/.claude/worktrees/agent-skills-npm-packages-770857/.refs/`
  was re-created at 11:40 CEST and holds only `prisma/`.
- The slice-1 heartbeat records the cause:
  `2026-08-21T09:40:28Z RECOVERY — .refs/prisma was deleted externally
  ~11:38, losing branch + 3 commits`. The deletion removed the whole
  `.refs/` tree, composer included. Slice 1 re-cloned and is redoing its
  work; slice 4 has not, and its heartbeat stops at
  `2026-08-21T09:37:56Z … next=gate-complete` — roughly one minute
  before the wipe.
- No surviving copy: the two other composer checkouts on disk
  (`/Users/will/Projects/prisma/composer`,
  `/Users/will/Projects/prisma/prisma-cli/.claude/worktrees/s2c-implementation-setup-ae2532/composer`)
  have no `skill-in-tarball` branch, local or remote, and no
  `scripts/stage-skills.mjs` or `scripts/skill-frontmatter.ts` exists
  anywhere the filesystem search reached. The branch was never pushed
  (the slice's commit/push rules defer pushing to the orchestrator), so
  there is no remote copy either.

Required action: the slice-4 implementer re-clones prisma/composer into
`.refs/composer`, re-creates branch `skill-in-tarball`, and redoes the
three tasks from its own context, exactly as the slice-1 implementer
did. Push the branch (or otherwise place the commits outside `.refs/`)
as soon as the work is committed, so a second wipe cannot repeat this.
Re-run the slice validation gate on the rebuilt branch before the next
review round.

### S2-R1-1 — major — `packages/cli/src/lib/skills/project-root.ts:184` (`descendants`), consumed at `packages/cli/src/lib/skills/status.ts:102`

A workspace glob containing `**` expands by recursing into every
directory under the project, and the result becomes the list of
directories the four allowlisted packages are resolved from. Both halves
run on every `prisma` command, because the check calls
`readSkillsStatus` → `findInstalledSourcePackages` →
`workspaceMemberDirs` unconditionally.

`descendants` filters out `node_modules` and nothing else, so it walks
`.git`, `dist`, `.turbo`, `coverage`, and every source directory.
Measured on two real checkouts in this environment: 1,975 directories
in 187 ms, and 8,992 directories in 749 ms. The resolution pass then
multiplies: 4 package names × every directory the walk returned, each
miss costing two failed `require.resolve` calls — 2,000 such resolutions
take 130 ms here, so a `**` workspace producing ~2,000 candidate
directories adds roughly another 500 ms. Together that is on the order
of a second added to every command.

`packages/**` is an ordinary pnpm and npm workspace pattern, and the
slice's own test (`packages/cli/tests/skills-project.test.ts:88`)
exercises it, so this is a supported path rather than an exotic one.
Design brief §4 pins the check's cost at "a few stat calls and small
file reads; milliseconds", and the implementer's report repeats that
claim; with a `**` glob it does not hold.

The expansion is also wrong on its own terms: a `dist/` directory inside
a package is not a workspace member, but `descendants` returns it and
the resolver is then pointed at it.

Required action: bound the `**` expansion — stop descending once a
directory holds a `package.json` (that directory is the member), and
skip dot-directories — so the walk and the resolution pass are both
proportional to the number of declared members rather than to the size
of the working tree. If that still leaves the check's per-command cost
above the brief's budget, move member enumeration out of the check's
path instead. Add a test that a `**` workspace yields only the
directories that are actually packages.

### S2-R1-2 — minor — `packages/cli/src/commands/skills/sync.ts:78`

`skills sync` reports `check: enabled` in a project whose
`prisma.config.ts` sets `skills: { check: false }`. Its `checkDisabled`
comes only from `readSkillsCheckDisabled`, which reads
`.prisma/skills.json` and nothing else, while `skills list`
(`list.ts:36`) correctly combines that file with `!ctx.config.check`.
The two commands therefore print contradictory answers about the same
setting, and the wrong one appears in both the human `check` field and
the `--json` payload. The check itself honours the config key, so only
the reported state is wrong.

Required action: give `skillsSyncCommand` the same
`needs: { config: skillsConfigSection }` and fold `!ctx.config.check`
into the reported `checkDisabled`, matching `list`. Cover it with the
config fixture the list test at `skills-sync.test.ts:444` already uses.

### S4-R1-2 — low — `.refs/composer` `.agents/rules/user-facing-surface-changes.mdc:17`

This rule is `alwaysApply: true`, so every agent working in prisma/composer
reads it, and line 17 still describes the skill as "installed into other
people's repos (`npx skills add`)". That is the mechanism this PR retires. A
contributor or agent acting on the rule will reach for the GitHub route and
reason about the skill as something fetched by ref rather than something that
travels in the tarball.

It matters more than a stray mention because of what the rule is for: it exists
to stop the two shipped surfaces going stale silently, and it is the one
document in the repo that tells a contributor how the skill reaches users.
Every other user-facing reference in the repo was repointed correctly — the
only remaining `npx skills add prisma/composer` is the deliberate fallback
section at `skills/README.md:53`, which is right — so this is a single missed
line rather than a pattern.

Required action: update the parenthetical to say the skill ships inside the
`@prisma/composer` tarball and is installed with `prisma skills sync`, keeping
the rule's substance unchanged.

### S1-R1-1 — major — `.refs/prisma` `packages/0-shared/publish-surface/test/package-skills.test.ts`

The slice spec's task 3 asks for a tarball test: "each tarball contains
`skills/prisma-8/SKILL.md` with the right stamp." This test never makes a
tarball. It runs `scripts/sync-package-skills.ts` directly and inspects the
directory left behind, then asserts as a string that each manifest's `prepack`
mentions the script. Its own header states the assumption it rests on —
that what the script leaves behind "is what `npm pack` collects."

That assumption is exactly the thing worth checking here, because each
package's `files` lists `skills` while `.gitignore` ignores
`packages/9-public/@prisma/*/skills/`. How npm's pack list resolves a `files`
entry that names a gitignored directory has been a long-standing footgun, and
the failure is silent: the tarballs ship with no skills, every assertion in
this test still passes, and the first person to find out is a user whose
`prisma skills sync` finds nothing. The test also never exercises `prepack`
itself, so the script's `import.meta.url === \`file://${process.argv[1]}\``
main-module guard is only ever proven under the direct `node <abs-path>`
invocation the test uses, not under the relative invocation `prepack` performs.

Slice 4 in this same project treats the identical risk as the reason its check
exists, and `scripts/check-skill-packaging.mjs` there is the working model: run
`pnpm pack`, extract, read the skill back out of the packed artifact, and
assert its stamp. Two slices in one project should not disagree about how much
proof this claim needs.

In fairness to the implementer, `publish-surface` has no existing pack-based
test, so this follows the package's established style — the gap is against the
slice spec's wording and against the sibling slice, not against local
convention.

Required action: pack each of the three packages (or one, with the other two
covered by the manifest assertions already present) and assert
`skills/prisma-8/SKILL.md` is inside the tarball with `metadata.library` equal
to that package and `metadata.library_version` equal to its version. Mirror
`check-skill-packaging.mjs` rather than inventing a second approach.

### S3-R1-1 — major — `.refs/prisma` `packages/1-framework/3-tooling/cli/src/commands/init/hygiene-package-scripts.ts:33` and `src/orm/init.ts:156`

The `postinstall` script init writes names a binary the project it just
scaffolded does not have.

`init.ts:156` installs `const cliDevDeps = ['@prisma/cli@next']` as the
project's development dependency. In prisma/prisma-cli, `@prisma/cli`
declares exactly one bin, `prisma-cli` — the `prisma` bin belongs to the
separate `prisma` package, which init never installs. So the project's
`node_modules/.bin/` holds `prisma-cli` and nothing named `prisma`.

The script written into the user's manifest is
`"postinstall": "prisma skills sync || exit 0"`. It therefore fails on every
install, and `|| exit 0` — which exists to tolerate a production install with
no development dependencies — swallows the failure. Nothing reports it. The
postinstall is the primary delivery mechanism in brief v2 §3, the thing that
makes the whole design eventually consistent, and in a project created by
`prisma orm init` it never runs successfully even once.

The integration test locks the defect in rather than catching it:
`test/integration/test/cli.init-skill-distribution.integration.test.ts:99`
asserts `postinstall: 'prisma skills sync || exit 0'` while line 83, in the
same file, asserts the sync init actually runs is
`dlx @prisma/cli@next skills sync`. Two different binaries, asserted fifteen
lines apart, neither reconciled against what the project installs.

There is a third spelling in the same PR: `formatSkillSyncCommand`
(`skill-sources.ts:24`) tells the user to run
`pnpm dlx @prisma/cli@next skills sync`, downloading a fresh copy of the CLI
rather than using the development dependency the project already has —
`pnpm exec prisma-cli skills sync` would use what is installed.

Required action: make the binary the postinstall names the binary the project
gets. Either write `prisma-cli skills sync || exit 0` to match
`cliDevDeps`, or change `cliDevDeps` to install the `prisma` package. Then
bring the advice string and the integration-test assertions onto the same
spelling, so the PR states one answer instead of three. Note that this
interacts with the naming question recorded against slices 2 and 4 — settling
that first will decide which of the two fixes is right — but the two strings
inside this PR must agree either way.

### S2-R2-1 — low — `packages/cli/src/commands/service/errors.ts:38,51,60,83`

Commit dfaed85 added a second accepted spelling throughout the legacy error
rewriter — `COMMAND_PREFIXES`, the extra `replaceAll` for `${CLI_NAME} app `,
and the `.some(...)` filter — so that a guidance builder "modernised ahead of
this layer" keeps its command lines. Nothing tests that branch, and nothing in
the repo produces its input.

Every existing case drives the rewriter with the legacy spelling only:
`service-compute-config.test.ts:125,220` and `service-domain-wait.test.ts:142`
all assert on `prisma-cli app `, and `lib/app/domain-guidance.ts` — the legacy
builder those tests exercise — writes `prisma-cli app …` at all five call
sites. Delete the entire new branch and the suite still passes.

The branch is not cosmetic, which is why the gap matters. If it is wrong, a
step spelled `prisma app domain retry <host>` keeps the `app` noun that
`renameAppCopy` exists to remove, and `fromLegacyCliError`'s filter drops it
from `nextActions` entirely — the user loses the suggested command rather than
seeing a wrong one. The implementer named this the part worth reviewing; it is,
and it is the one part with no coverage.

Required action: either add a case that feeds the rewriter a
`${CLI_NAME} app …` next-step and asserts it comes back as
`${CLI_NAME} service …` and survives into `nextActions`, or drop the branch
until a producer exists. Speculative tolerance with no test is the one option
to avoid.

**PREMISE CORRECTED (round 3) — I was wrong about half of this finding, and
the implementer was right to push back.**

Two claims above are false. "Nothing in the repo produces its input" and
"delete the entire new branch and the suite still passes" are both incorrect.
`computeConfigErrorToCliError` (`src/lib/app/compute-config.ts:46`) builds
`const command = \`prisma service ${commandName}\`` and puts it in `nextSteps`;
`service/target.ts:149,174` pass that error through `fromLegacyCliError`. So
the current-spelling branch has a live producer on a real command path, and
removing it drops those next steps — the implementer verified two failures in
`service-compute-config.test.ts`, which is consistent with the
`expect(error.nextActions).toEqual([...])` assertions at lines 103 and 208.

I should have found this. My check was a grep for the literal `prisma app `,
which is the wrong string: the producer writes `prisma service `, and it is the
*filter* in `fromLegacyCliError` — not `renameAppCopy` — that needs the current
prefix in order to keep the step at all.

The correction runs deeper than a missed producer. dfaed85 itself changed
`compute-config.ts:46` from `prisma-cli service …` to `prisma service …`. Under
the old `CLI_NAME` that string began `prisma-cli ` and the legacy prefix
matched it; after the rename it does not. So the branch is not speculative
future-proofing at all — it is a **required repair for a regression the rename
would otherwise have introduced**, and the commit message says exactly that. My
framing of it as tolerance for a hypothetical modernised builder was wrong, and
"speculative tolerance with no test is the one option to avoid" was advice
aimed at a situation that did not exist.

What survives is the narrow half: a behaviour branch added in this PR had no
test naming it, and a silent-drop failure mode deserves one. That half is now
addressed — see the round-3 note.

### S2-R3-1 — low — `packages/cli/src/commands/project/errors.ts:45-53`

`portCommandString` now carries a dead branch under a comment that
contradicts itself, both left by the dfaed85 sweep.

With `CLI_NAME` equal to `"prisma"`, the first two guards are the same test:

```
if (command.startsWith(`${CLI_NAME} `)) return command;
if (command.startsWith("prisma ")) { ... }   // unreachable
```

The second branch can never run. Before the rename it was the one that did the
work — `CLI_NAME` was `prisma-cli`, so the first guard caught legacy strings
and the second caught the single `prisma auth login` copy bug and rewrote it.
Now that outlier is caught by the first guard and returned unchanged, which
happens to be the right answer, so nothing misbehaves — but the code says
otherwise.

The comment above it was rewritten to "Legacy command strings are `prisma …`,
except one `prisma auth login` copy bug", which no longer parses as a
statement: the exception names the same spelling as the rule. The original
sentence was true and explained why the second branch existed.

Required action: delete the unreachable branch and rewrite the comment to
describe what the function now does — legacy strings already arrive in the
current spelling, and only the package-runner prefix still needs rewriting.

### S2-R3-2 — low — `packages/cli/e2e/declared-bin.e2e.ts:20`

The sweep renamed this test to "maps prisma to the built CLI" while its single
assertion pins the opposite:

```
expect(packageJson.bin).toEqual({ "prisma-cli": "./dist/cli.js" });
```

That assertion is correct and must stay — `packages/cli` really does declare
`prisma-cli`; the `prisma` bin belongs to `packages/prisma`. The test exists to
pin that package-level fact, so the title was naming a package name, not a
command a user types, and should not have been swept.

It is worth fixing rather than leaving because of which way a reader would
resolve the contradiction: the natural reading is that the assertion is stale,
and "correcting" it would change what this package publishes.

Required action: restore the title to name `prisma-cli`.

### S2-R2-2 — low — `packages/cli/src/cli-name.ts:11`

The rename sweep rewrote a URL that names an external fact, and the comment is
now wrong. It reads "The old /docs/orm/tools/prisma path 308-redirects to the
ORM CLI reference"; the path that actually redirects is
`/docs/orm/tools/prisma-cli`, which is why the comment cited it. The comment is
the recorded reason `CLI_DOCS_URL` points at the docs root instead of a
specific page, so a reader checking that reasoning now follows a path that is
not the one being described.

`docs/product/output-conventions.md:94` kept the correct
`https://www.prisma.io/docs/orm/tools/prisma-cli` spelling, so the two now
disagree about the same URL.

Required action: restore `/docs/orm/tools/prisma-cli` in the comment. Worth a
quick pass for any other place where the sweep rewrote a URL, an npm package
name, or an analytics identifier rather than a command a user types.

## Round notes

**Slice 4, round 1 — no review performed.** I could not read a single
line of the implementation; the branch, its three commits, and the clone
that held them are gone. Nothing in this round says anything about the
quality of the implementer's work — the summary it reported (stamping in
`skill-frontmatter.ts` + `set-version.ts`, prepack staging via
`stage-skills.mjs`, `check-skill-packaging.mjs` in `ci.yml` and
`publish.yml`, docs repointed to `prisma skills sync`) reads as a
plausible match to the slice spec, but a summary is not reviewable
evidence and I am not going to score it as if it were.

Two things worth the orchestrator's attention beyond the finding itself.
First, `.refs/` is a working directory holding the only copy of two
slices' output; the slice-1 implementer lost three commits the same way
about two minutes after slice 4 did, so the exposure is structural, not
a one-off. Pushing each slice branch to its bot remote as soon as the
first commit lands would cost nothing and would have made both losses
recoverable. Second, slice 4's implementer reported completion and does
not appear to know its work is gone — it needs to be told before it
reports the gate as passed a second time.

I hold no state from a prior round on this slice, so the rebuilt branch
gets a full first-round review whenever it exists.

**S4-R1-1 resolved.** The coordinator reports the `.refs/` disappearance
was slice 2's implementer parking the tree in `/tmp` to unblock root
lint, and that it restored everything: slice 4's branch is back at
`.refs/composer` (`skill-in-tarball`, head 3221d83), to be re-verified
and pushed by its implementer. No work was lost and there is no defect
to fix. The scoreboard row is marked resolved; slice 4 still owes a real
round 1, which I will run against the restored branch.

**Slice 2, round 1.** The implementation matches the brief closely and
the tests are the strongest part of it. Two things must change before I
can call it satisfied, and neither touches the design.

The security invariant holds, and I checked it directly rather than
taking the comment's word for it. Nothing in the slice walks
`node_modules`: `subdirectories` in `project-root.ts` excludes it by
name, `resolve.ts` goes through `createRequire` for allowlisted names
only, and the two directory reads that do happen are inside an already
resolved allowlisted package (`<pkg>/skills`) and inside the project's
own harness directories. Pruning is keyed on the copied `SKILL.md`'s
`library` stamp *and* re-checked against the allowlist, so a skill some
other tool put in `.claude/skills/` is never deleted. The invariant
comment at the allowlist declaration says all four things the slice
spec asked for — only these packages, never scan, no discovery mode,
permanent — and says why, in terms of the trust boundary rather than as
a rule to obey.

On the check's off switches: all eight are implemented and all eight are
tested, including the two spellings of `--format json` and the case
commit 281dad5 fixed, where a global flag precedes the `skills` group.
The `CI`/`GITHUB_ACTIONS` pair is exactly what `update-check.ts:179`
already does, so the check is consistent with its neighbour rather than
inventing a second CI notion — the right call even though the engine's
richer `resolveIsCI` was available. The ordering claim also checks out:
`prisma.config.ts` is only evaluated after the project is already known
to be stale, which matters because evaluating it costs a TypeScript
transpile. Placing the check in `main.ts` after `cli.run` rather than as
an engine hook is justified in the code — every mounted family
dispatches through that one call — and the exit code is genuinely
untouched (there is a test for a failing command).

On the bin name: the implementer's report says the notice "will say
whatever bin name the user invoked". That is not what the code does —
`getCliName()` returns the compile-time constant `CLI_NAME`, which is
`"prisma-cli"`. So the notice reads `Run: prisma-cli skills sync` and
`docs/product/output-conventions.md` documents that string, while the
brief's literal text and the `postinstall` line slice 3 will write both
say `prisma`. I am not filing this, because `CLI_NAME` is used for every
user-facing command string in this package and diverging here would be
worse than the mismatch. But the mismatch is real and it is not this
slice's to fix: `packages/prisma` publishes the `prisma` bin and bundles
`@prisma/cli`'s source unchanged, so a user who installs the primary
package is told to run a binary they do not have. That predates this
work (commit 40b6855 moved the published bin to `prisma` without moving
`CLI_NAME`), but this project makes it visible in a new place and slice 3
will hard-code the other spelling. It wants an owner outside this slice.

Two smaller things I looked at and decided against filing. The doc
comment on `opt-out.ts:8` says the opt-out "follows the project rather
than one machine's environment" — but `.prisma/` is local, gitignored
state, so it follows the checkout, not the project; the accurate
project-wide switch is the `prisma.config.ts` key, which the comment on
`config.ts:6` describes correctly. And stamp-based pruning cannot tell a
copy this CLI made from one the documented GitHub fallback route
(`npx skills add prisma/prisma/skills#v<version>`) made, since both carry
the same `library` stamp — so a user on the fallback route who has not
installed the package will find `skills sync` deleting their copy. That
follows from the brief's choice to key pruning on the stamp, and is
worth a line in the fallback's documentation rather than a code change.

`--disable`/`--enable` is a pair of opposite booleans needing a
mutual-exclusion error, which is the shape `docs/product/cli-style-guide.md:148`
("boolean negation uses `--no-<flag>`") exists to avoid. Both spellings
are pinned by the slice spec, so I am not filing it and I am not asking
for a rename; recording it only so the deviation is a decision rather
than an oversight.

Test quality is high enough to call out. The Yarn PnP test does not fake
a passing result: it patches `Module._resolveFilename` to answer with a
path inside a zip and patches `node:fs/promises` to read from behind it,
which is precisely the pair of requirements PnP imposes, so it would
fail if the sync ever built a `node_modules` path itself or reached for
an fs API the PnP layer does not patch. `isolateModuleResolution` in the
fixture helper catches a trap that would have made every fixture project
appear to have two allowlisted packages installed, because vitest points
`NODE_PATH` at the repository store. The extraction of `semver-order.ts`
out of `update-check.ts` is real reuse rather than a copy. Surface pins
(mount coverage, conformance sections, e2e exclusions) were all updated
with reasons rather than left to fail.

I did not re-run the validation gate, per the review brief.

**Slice 4, round 1 (real).** Reviewed `3a931e74`, `65b52fe8`, `3221d831` at
`.refs/composer`. This is careful work and the packaging half is right for the
reason that matters: the claim "the tarball carries the stamped skill" is
proved by packing the tarball and reading the skill back out of it, not by a
unit test of the code that was supposed to put it there. That distinction is
the whole difference between a check that catches the failure and one that
restates the intent, and `check-skill-packaging.mjs` says so in its own header.
It is not vacuous either — it derives the expected skill list from the
repo-root tree, fails if that list is empty, and fails if the packed file is
absent, has the wrong `library`, carries the wrong version, or differs by a
byte from the tracked source.

Lockstep holds by construction, and I traced it rather than assuming it.
`set-version.ts` writes one `version` into every workspace package and stamps
`library_version` from that same variable, so the packed package's version and
the skill's stamp cannot diverge without someone hand-editing one of them —
which is exactly what the packed-artifact check catches. The publish workflow
orders it correctly: determine version → set versions (stamps the skill) →
build → `check:skill-packaging` → publish, and the dev follow-up re-runs the
check after re-stamping. Publishing goes through `pnpm publish` per package
with no `--ignore-scripts`, so `prepack` genuinely runs; `prepack` rather than
a build step is the right choice and the reason is recorded — a turbo cache
cannot restore a stale staged copy into a tarball that way.

The CI wiring does run where it claims. `check:skill-packaging` sits in the
`cli-engine pin and externality` job, which runs on `pull_request` and on
pushes to `main` and builds the public packages first; `test:scripts` (which
globs `scripts/*.test.ts` and so picks up the new `skill-frontmatter.test.ts`)
is already wired in two places in `ci.yml`. The one cosmetic consequence is
that the job's name no longer describes its contents.

The frontmatter helper is more careful than it needed to be, correctly. It
matches keys only inside the frontmatter block, `^library:` cannot match
`library_version:`, both replacements use the function form so a literal `$&`
in the skill's prose is not expanded as a capture reference, and it refuses to
stamp a skill that does not already declare `library` — which is the right
call, since silently inserting the key would let a skill be stamped with a
version that means nothing. The tests cover all of that, including a folded
`description` containing a decoy `library_version:` line and a decoy in the
body, and they assert byte-identity outside the one replacement rather than
just re-parsing the result.

Routing skills to packages by reading each `SKILL.md`'s own `library` key,
instead of a table in the script, is the right design and removes a thing that
could drift. The security invariant is untouched: nothing here scans anything;
`stage-skills.mjs` reads the repo's own tracked `skills/` tree and writes only
into the packing package's own directory.

Three things for the orchestrator, none of them the implementer's to fix.

First, and most important: **the bin-name collision between this slice and
slice 2 is now confirmed from both sides, and slice 4 is the side that is
right.** Composer's docs tell users `pnpm add -D prisma` and then
`prisma skills sync`. That is accurate — prisma-cli's `packages/prisma`
publishes under the npm name `prisma` with a `prisma` bin, and no `prisma-cli`
binary exists for such a user. Slice 2's stale-skills notice, meanwhile, prints
`Run: prisma-cli skills sync`, because `CLI_NAME` in prisma-cli was never moved
when commit 40b6855 changed the published bin. So a user who follows composer's
README will be told by the CLI to run a command they do not have. Slice 4 needs
no change; the fix belongs in prisma-cli, and I flagged it in the slice 2 note
as needing an owner. This second, independent confirmation should settle it.

Second, merge and release ordering. `prisma skills sync` does not exist on npm
until prisma-cli ships slice 2, so every repointed doc in this PR names a
command that will not work on the day it merges. The README, `skills/README.md`
and `docs/guides/getting-started.md` repoints were mandated by the slice spec,
so the implementer had no choice and the sequencing is the orchestrator's call
— `plan.md` already carries a release-order note. But `website/src/template.ts`
is different in kind and was **not** in the spec's list of files to repoint. It
is the landing page's single call to action, it deploys from this repo, and the
change replaces a command that works today and needs no install
(`npx skills add prisma/composer`) with `pnpm add @prisma/composer prisma &&
pnpm prisma skills sync` — two package installs plus an unreleased CLI. Beyond
the timing, that alters the page's pitch from "one command and your agent knows
the API" to "install two packages first", which is a product decision about the
site rather than a packaging correctness question. I am not filing it, because
filing would mean asserting I know the right hero copy. I would either split
that one edit out of this PR or get it confirmed by whoever owns the site
before merging.

Third, two smaller things worth knowing rather than fixing.
`check-skill-packaging.mjs` hardcodes `@prisma/composer` while
`stage-skills.mjs` is generic, so a second skill-bearing package in this repo
would be staged but never verified — fine today, a trap later. And the
authoring rules in `skills/README.md` gained no line about the new stamp keys;
the failure modes are all caught loudly (`stampSkillVersion` throws, the
packaging check fails), so nothing silently breaks, but a contributor adding a
second skill under `skills/` will find out by breaking the release script
rather than by reading the rules.

One cross-slice question that is above this slice: the contract puts `library`
and `library_version` at the top level of the SKILL.md frontmatter. Mastra
tucked its equivalent under `metadata`. If any harness rejects or warns on
unknown top-level frontmatter keys, that affects all four slices at once and is
cheaper to settle now than after publishing. Worth one deliberate confirmation
against the harnesses in the contract (`.claude`, `.cursor`, `.agents`,
`.windsurf`) rather than an assumption.

I did not re-run the validation gate, per the review brief and the
coordinator's report of the green re-run.

**Slice 4, round 2 — `eecf6f06`.** Both findings are fixed and the metadata
move is correct. No new findings. But this commit creates a cross-slice break
that must be closed before anything merges, so the slice is satisfied on its
own terms and blocked on someone else's change.

**The blocker, first.** Moving the stamp under `metadata:` breaks slice 2's
reader. `packages/cli/src/lib/skills/frontmatter.ts:41` skips any line starting
with a space or a tab, and matches `library` / `library_version` only at the
top level; `metadata:` itself is not a key it knows. So against the new layout
it returns `{ library: null, libraryVersion: null }`, and the consequences run
all the way through `status.ts`: every harness target reports `absent` rather
than `synced`, `upToDate` is never true, `prisma skills sync` re-copies all
four directories on every run, the check prints "synced none" after every
command forever, and `findOrphanedSkills` returns early on the null library so
pruning silently stops working altogether. That is the whole feature failing
quietly, not a rough edge.

I checked slice 1 rather than assuming: `skills-in-tarball-packaging` in
`.refs/prisma` already stamps under `metadata:` too
(`skills/prisma-8/SKILL.md:18-20`, with single quotes rather than double —
valid YAML either way, and both parsers accept both, so that is cosmetic). So
slices 1 and 4 agree and slice 2 is the only one left on the old layout.
`plan.md`'s cross-slice contract still specifies the top-level keys, and slice
4's own spec (task 2) still says `library:` / `library_version:` verbatim.

Required, outside this PR: amend the contract line in `plan.md`, teach slice
2's `parseSkillStamp` to read the `metadata` map, and add a test there for a
metadata-stamped skill. Slice 2 is already in rework for S2-R1-1 and S2-R1-2,
so this rides along at no extra cost — but the ordering is not optional, and a
merge of slice 1 or 4 ahead of it ships skills that the CLI cannot recognise.

**On the amendment itself: right call, and better founded than the contract it
replaces.** This is the cross-slice question I raised at the end of round 1,
and the implementer did not just move the keys — the reasoning is recorded at
`scripts/skill-frontmatter.ts:10-15` and in the new authoring rule: the Agent
Skills spec defines the top-level key set and reserves `metadata` as a
string→string map for exactly this kind of publisher extension, so a top-level
`library:` is an undefined key a strict runtime may reject. The string→string
constraint is honoured rather than merely mentioned — the stamp is written
quoted, and there is a test pinning that (`skill-frontmatter.test.ts`,
"keeps the version a quoted string").

The parsing changes hold up under the cases that usually break this kind of
edit. `keyPattern` now requires leading indentation and is applied only to the
metadata block, so nothing outside the map can be read or rewritten;
`^[ \t]+library:` still cannot match `library_version:`, because the literal
colon has to follow `library`. The replacement preserves the line's own
indentation instead of assuming two spaces. The top-level keys are now
deliberately ignored, and there is a negative test proving it rather than an
assertion in a comment — which matters, because silently accepting both layouts
is what would have let slice 2's mismatch go unnoticed. The three error
messages name `metadata.library` / `metadata.library_version` and say why the
keys live there, so a contributor who hits one is told the rule and its reason
in the same breath. A flow-style `metadata: {library: x}` would not match and
would raise the clear "no `metadata` map" error rather than misparsing.

Test count moves 180 → 183, matching the three added cases exactly.

**S4-R1-2 is fixed.** The rule at `.agents/rules/user-facing-surface-changes.mdc`
now describes the tarball route and `prisma skills sync`, and it goes one
better than I asked by naming the property that makes the new mechanism worth
having — the skill reaches users on their next upgrade whether or not anyone
re-runs an install command.

**The website hero revert is real.** `git diff main..eecf6f06 -- website/` is
empty, so `website/src/template.ts` is byte-identical to `main` and the landing
page keeps the command that works today. That was the right resolution: the
hero can be repointed in its own change once the CLI is published, with whoever
owns the site looking at the copy.

The new authoring rule in `skills/README.md` closes the gap I noted last round.
It tells a contributor not to hand-edit the version, that both keys are
required on a new skill, and why the map is where it is. Everything else from
round 1 — the packed-artifact check, lockstep stamping, publish ordering,
`prepack` wiring, CI placement — is untouched by this commit and still stands.

**Slice 1, round 1.** One finding (S1-R1-1). Everything else I checked holds
up, and the fold — the part with the most room to go quietly wrong — was done
carefully.

The fold did not lose instructions. The two standalone skills moved as git
renames (65% and 60% similarity), and reading the surviving delta line by line,
every change is either a relink to the new path or a deliberate rewrite of the
one section the new delivery model invalidates. That section is worth naming,
because the implementer noticed something the brief only implies: when the
skill ships inside the installed package, the upgrade instructions on disk
describe the version you are *on*, not the version you are moving *to*. The old
Step 0 said reinstall the skill at `@latest` and reload. The new one says bump
first, run `prisma skills sync`, then re-read the reference and the
per-transition instructions before applying any translation. That is the
correct consequence of the design, and it is the kind of thing a mechanical
fold would have left broken. The two deleted `README.md` files described the
standalone install model being retired; their surviving substance (the
cumulative instruction set, the app/extension audience split) is carried in
`references/upgrade-app.md`. The per-transition directories moved with
zero-line diffs apart from three small path corrections.

The router description is 956 characters — I measured the folded scalar rather
than taking the number on trust — and it does carry the upgrade triggers
("upgrade Prisma 8", "bump Prisma Next", "move to Prisma Next X.Y",
`@internal/*` version bump, app *and* extension package). Both new references
are in the routing table with their own trigger columns, and the
disambiguating-question list gained the app-vs-extension question. So the fold
does what the brief's design item 3 asked: three registered skills become one
without losing the trigger surface.

The coverage-check repoint is better than a constant swap. `USER_SKILL_PKG` /
`EXT_SKILL_PKG` now point at the folded directories, and the path regex is
*derived* from them through an escaping helper instead of being a second
hand-written literal, so the two can no longer drift. The violation message
interpolates the same constants rather than restating the paths. That is the
right shape for a check whose whole job is to notice a missing directory.

The stamp matches slices 2 and 4 in shape: `metadata.library` /
`metadata.library_version`, values quoted. Slice 1 writes single quotes and
slice 4 double — both valid YAML, and slice 2's reader accepts either, so it is
cosmetic. `validate-skills.mjs` now enforces that `metadata` is a map of string
values, and the comment explains the failure it is really guarding against:
YAML reads an unquoted `8.1` as a number, and a consumer comparing it to a
package-version string finds no match. `stampSkillMetadata` confines its
rewrite to the metadata block and has seven unit tests including idempotence
and all three refusal paths. The per-destination `library` rewrite is right —
each tarball's copy names the package it was resolved from, so slice 2's
allowlist check on the copy's stamp succeeds whichever of the three a user
installed.

The two scope-adjacent edits are both justified and both narrow. Shrinking
`DEFAULT_SKILL_SOURCES` to one entry and moving the two folded names into
`RETIRED_SKILL_NAMES` is what keeps `main` green between this slice and slice
3, and it also means an existing project gets the stale directories cleaned up.
The throw-ratchet widening from `skills/[^/]+/upgrades/` to
`skills/.+/upgrades/` is precisely what the deeper path requires and stays
anchored on `/upgrades/`, so it does not exempt anything new in kind.

The cross-slice blocker recorded under slice 4 round 2 applies here too, and is
now confirmed from a third side: slice 2's `parseSkillStamp` reads top-level
keys and explicitly skips indented lines, so it cannot read this stamp either.
Slices 1 and 4 agree; slice 2 and `plan.md` are the ones that must move.

**Slice 3, round 1.** One finding (S3-R1-1), and it is the serious kind — the
mechanism the design leans on does not work in a project init creates. The rest
of the slice is clean and several of its judgement calls are good ones.

`--skip-skills` coverage is complete. All three effects — the sync run, the
`postinstall` script, and the gitignore lines — hang off the single
`inputs.installProjectSkill` flag, checked in `init.ts` for the sync and in
`init-scaffold.ts` for the other two, and the integration test asserts all
three are absent under the flag. There is no fourth thing left switched on.

The gitignore choice is right, and the reasoning in the code is why I agree
with it: the entries name `.claude/skills/prisma-8/` rather than
`.claude/skills/`, because a project's own hand-written skills live as siblings
in those directories and must stay tracked. Ignoring the harness directory
would have quietly untracked user work. `mergeGitignore` gained a defaulted
parameter rather than a second function, so the idempotent-merge behaviour is
unchanged and shared.

The warning-not-finding downgrade is faithful to the brief. Brief v2 §4 closes
on the postinstall and the check making the system eventually consistent, and
the code says exactly that at the call site: a failed first sync is not a failed
init, because the postinstall retries on the next install and every `prisma`
command reports the mismatch meanwhile. Exit code 6 is gone from
`INIT_EXIT_CODES`, `skillInstallFailedFinding` is deleted, and
`error-reference.md` is updated. That is a clean retirement rather than a dead
branch left behind. The one caveat is that the argument depends on the
postinstall actually running — which is what S3-R1-1 is about.

No `skills add` or `npx skills` invocation remains anywhere under the CLI
package's `src/`; I grepped rather than trusting the claim. The integration
test is a real rewrite — five cases, no network, including one asserting init
fetches nothing from GitHub any more — and the `RETIRED_SKILL_NAMES` cleanup is
still exercised. Adding `.cursor` to `AGENT_SKILL_ROOTS` brings init in line
with the four harness directories the contract names.

One thing that is not a finding but is worth attention: `formatSkillSyncCommand`
builds `pnpm dlx @prisma/cli@next skills sync` for the advice init prints. Even
once the binary question is settled, telling a user to `dlx` a fresh copy of a
CLI their project already has as a development dependency is the wrong
instruction; `pnpm exec` (or the manager's equivalent) is what a project with
the dependency installed should be told to run.

**Slice 2, round 2.** Both round-1 findings are properly fixed, the metadata
reader closes the cross-slice blocker, and the rename is careful. Two new
findings, both small; neither is in the skills code.

**S2-R1-1 is fixed, and bounded twice over rather than once.** `descendants`
now returns immediately when a directory holds a `package.json` — that
directory is the member, everything below it is that package's own contents —
and `subdirectories` skips dot-directories as well as `node_modules`. Then
`workspaceMemberDirs` filters the result to manifest-holding directories, so
the resolver is never pointed at a directory that is not a package. I traced
the `packages/**` case specifically: the walk reaches `packages/`, descends one
level, and stops at each member, so a member's `dist/` is unreachable — the
only way back in would be a `dist/` sitting under a grouping directory that has
no manifest of its own, which is not a shape that occurs. Skipping dot
directories during glob expansion is also the conventional behaviour (shell
globs do not match dotfiles), and literal path segments still resolve, so
`.config/x` as a declared pattern keeps working.

The regression test is the right kind: `skills-workspace-scan.test.ts` counts
the actual `readdir` calls, asserts the walk touched only `packages` and
`packages/group`, asserts no `dist` directory was read, and caps the total. It
fails if either bound is removed, which is what a performance fix needs — an
assertion about behaviour, not a benchmark.

**S2-R1-2 is fixed** exactly as asked: `needs: { config }` on the sync command
and `optedOut || !ctx.config.check`, so `sync` and `list` now report the same
answer. The local variable rename from `checkDisabled` to `optedOut` for the
file-backed half is a small clarity win — the two states no longer share a name.

**The metadata reader closes the blocker I raised against slices 1 and 4.**
`parseSkillStamp` now tracks whether it is inside the `metadata:` map and reads
the stamp only there. I checked it against both writers rather than assuming:
slice 1 emits `  library: '@prisma/orm-postgres'` (single quotes) and slice 4
`  library: "@prisma/composer"` (double), and the existing `QUOTED` regex
accepts either. It also handles both key orderings — slice 4 puts `metadata:`
before `description:`, slice 1 after — because any non-indented line resets the
state, and a folded `description: >-` block's indented prose is skipped since
the state is false while inside it. Blank lines preserve the state rather than
ending the map. Refusing a top-level `library:` outright, with a test pinning
it, is the right choice: silently accepting both layouts is what would have
hidden this mismatch in the first place.

So the cross-slice code break is resolved. What remains is documentation:
`plan.md`'s cross-slice contract still describes the frontmatter keys without
saying they live under `metadata`, and slice 4's spec task 2 and slice 1's task
2 still name them bare. Those want amending so the next reader of the contract
sees what the three repos actually agreed on.

**On the rename.** The skills notice now reads exactly the brief's literal
string — `Run: prisma skills sync` — pinned by an equality assertion rather
than a substring match. The `fromLegacyCliError` work is the delicate part and
the mechanics are right: `CLI_NAME` is now a prefix of `LEGACY_CLI_NAME`, and
the prefix list is ordered legacy-first so `prisma-cli auth login` cannot be
mis-sliced; the two `replaceAll` calls are ordered so the legacy form is
consumed before the shorter pattern is tried. My only objection is the missing
test (S2-R2-1).

I swept for user-facing strings the rename should have caught and did not find
one. Every surviving `prisma-cli` is a deliberate survival of the kind the
operator listed: the entrypoint matcher and cache directory in
`update-check.ts`, the `git@github.com:prisma/prisma-cli.git` repo URLs in
`git/connect.ts` and `controllers/project.ts`, the `utm_source` / `utm_campaign`
analytics identifiers in `auth/login.ts` (not user-visible, and renaming would
break continuity), and `lib/app/domain-guidance.ts` — which is the legacy
guidance builder whose fixed strings are the *input* to `renameAppCopy`, so it
must keep the old spelling by design.

One thing the rename did not finish, which I am not filing because the commit
did not touch it and it predates this work: `isLikelyGlobalNpmEntrypoint`
(`update-check.ts:312`) matches only `/npm/prisma-cli` and
`/npm-global/bin/prisma-cli`. A user who installs the `prisma` package globally
now runs a binary that detector does not recognise, so the update notification
falls back to the docs link instead of naming a concrete update command. Mild
degradation, but the premise of this commit is that `prisma` is the binary
users have, which makes the gap newly conspicuous. Worth an owner outside this
slice.

**This also sharpens S3-R1-1.** With `CLI_NAME` now `prisma`, the postinstall
string slice 3 writes is the right one, and the defect is entirely on the other
side: slice 3 installs `@prisma/cli@next`, whose bin is `prisma-cli`. The fix
is therefore to install the `prisma` package, not to rename the script. The
prisma implementer should be told that before reworking slice 3.

I did not re-run the gate, per the coordinator's report of the green run.

**Slice 2, round 3.** Both round-2 findings are fixed. The important item is
not a fix, though — it is that the implementer pushed back on S2-R2-1's premise
with evidence and was right. I have corrected that entry in the findings log
rather than quietly marking it resolved, because the record should show what
was actually wrong with it.

**The correction.** I claimed the current-spelling branch had no producer and
that deleting it would leave the suite green. Both are false.
`computeConfigErrorToCliError` (`lib/app/compute-config.ts:46`) writes
`prisma service <command>` into `nextSteps`, and `service/target.ts:149,174`
route it through `fromLegacyCliError`; the `toEqual` assertions on
`error.nextActions` at `service-compute-config.test.ts:103,208` are the two
that fail without the branch, matching what the implementer measured. My check
was a grep for `prisma app `, and that is simply the wrong string — the
producer emits `prisma service `, and the guard that matters is the *filter* in
`fromLegacyCliError`, not `renameAppCopy`.

Worse for my framing: dfaed85 changed that very line from `prisma-cli service`
to `prisma service`. Under the old `CLI_NAME` the legacy prefix matched it;
after the rename it does not. The branch is a repair for a regression the
rename would otherwise have shipped — the commit message says so plainly — not
tolerance for a hypothetical future producer. Calling it speculative was wrong,
and so was the advice to consider dropping it.

The half that stood was the coverage gap, and it is now closed properly.
`tests/service-legacy-errors.test.ts` drives `renameAppCopy` and
`fromLegacyCliError` directly, one spelling per case, and its header records
the asymmetry that makes the branch matter: an unrecognised line is dropped
from `nextActions`, so the user loses a next step silently rather than seeing a
wrong one. That is the fact a future reader needs and the reason the test is
worth its lines. The mutation-sensitivity claim holds on reading: removing the
`${CLI_NAME} app ` replacement fails the second `renameAppCopy` case; removing
`${CLI_NAME} ` from `COMMAND_PREFIXES` fails "keeps a command line written with
the current name", because the filter runs on the raw step; and the third case,
"drops a line that names no binary at all", guards the opposite mistake of
making the filter permissive. Five tests, each pinning one behaviour.

**S2-R2-2 is fixed** and the commit message explains why the sweep caught it —
the path was followed by a space — which is the kind of note that stops the
same class of edit recurring.

**On the re-sweep.** The implementer reports that the docs path was the only
non-command rewrite in dfaed85. I checked by reading every removed line in that
commit that mentions the old name and is not a command string, and found two
more of the same kind, filed above as S2-R3-1 and S2-R3-2. Both are small,
neither changes behaviour, and both are the same failure mode as S2-R2-2: a
string naming a package, a legacy fact, or a URL rather than a command a user
types. The `portCommandString` one is the more useful catch, because the rename
did not just mis-word a comment there — it made a branch unreachable, so the
code and the comment are now both wrong about the same thing.

The skills work itself is untouched by this round and remains as verified in
round 2: both original findings fixed, the `**` walk bounded and regression-
tested by readdir count, and the metadata reader matching slices 1 and 4.

**Residual items to carry into the PR body when this lands.** None of these are
findings; they are decisions a reviewer of the PR should see stated rather than
discover.

- The feedback client's user-agent changed from `prisma-cli/<version>` to
  `prisma/<version>`. Orchestrator-accepted, but it is a wire-visible change to
  a service the CLI team reads, so whoever owns that dashboard should know
  before it lands rather than after.
- `isLikelyGlobalNpmEntrypoint` (`update-check.ts:312`) still matches only
  `prisma-cli` install paths, so a globally installed `prisma` gets the docs
  link instead of a concrete update command. Pre-existing and untouched here,
  newly conspicuous given the rename.
- The deliberate `prisma-cli` survivals, so nobody "finishes" the rename by
  mistake: the `@prisma/cli` package bin and its README, the update-check
  entrypoint matcher and cache directory, the `git@github.com:prisma/prisma-cli.git`
  repository URLs, the `utm_source` / `utm_campaign` sign-in tags, and
  `lib/app/domain-guidance.ts`, whose fixed strings are the *input* to
  `renameAppCopy` and must keep the old spelling by design.
- `plan.md`'s cross-slice contract, and slice 1's and slice 4's spec task 2,
  still name the frontmatter keys without saying they live under `metadata`.
  The code in all three repos now agrees; the contract text has not caught up.
- Slice 3 depends on this slice's outcome: with `CLI_NAME` now `prisma`, the
  postinstall string slice 3 writes is correct and the fix for S3-R1-1 is to
  install the `prisma` package rather than `@prisma/cli@next`.

I did not re-run the gate, per the coordinator's report of the green run.

## Orchestrator notes
