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
| Slice 2 | Round 4 | SATISFIED — both round-3 findings fixed, no new findings, no collateral damage |
| Slice 1 | Round 2 | SATISFIED — S1-R1-1 fixed by a real pack-and-read-back test, no new findings |
| Slice 3 | Round 2 | ANOTHER ROUND NEEDED (S3-R1-1 fixed end to end; one new low finding, S3-R2-1, in the quick-reference template init writes) |
| Slice 3 | Round 3 | SATISFIED — S3-R2-1 fixed in both templates, the comment, and all four snapshots; no new findings |
| Slice 2 | Round 5 (CI repair) | SATISFIED — the cli-engine revert is exact and both Windows failures were fixture-only; no new findings |
| Slice 3 | Round 4 (CI repair) | SATISFIED — the e2e harness now fakes the package init installs, the test's proof is intact, nothing else touched |
| Slice 2 | Round 6 (operator amendments) | SATISFIED — the rewriter is gone with no producer left on an old spelling, and amendments 2 and 3 hold; no new findings |
| Slice 3 | Round 5 (operator amendments) | ANOTHER ROUND NEEDED (amendments 1 and 2 met in code and tests; one new low finding, S3-R5-1, a doc left describing the retired postinstall) |
| Slice 3 | Round 6 | SATISFIED — S3-R5-1 fixed, the entry now names the staleness notice, and the commit is that one document |

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

### S3-R2-1 — low — `.refs/prisma` `packages/1-framework/3-tooling/cli/src/commands/init/templates/quick-reference-postgres.md:94-95` and `quick-reference-mongo.md:115-116`

These two files are rendered into the project as its quick reference, so they are strings init writes. Every other command in them now says `prisma`, but the "Monorepo notes" section still names the old package on two lines:

- "a `catalogs` entry for `@prisma/cli` or `{{pkg}}`" — init no longer installs `@prisma/cli`, so a catalog entry for that name no longer changes what init installs. The sentence tells the reader to look at the wrong entry.
- "`pnpm dlx @prisma/cli@next init …` works in any directory" — this is the one remaining place in the scaffolded documentation that names the package whose bin is `prisma-cli`, and it is also the pre-rename command spelling (`init` rather than `orm init`). `skills/README.md` in this same commit was updated to `pnpm dlx prisma@next orm init`, so the repository and the document it hands users now disagree.

Neither line breaks anything at run time — `pnpm dlx @prisma/cli@next` still resolves — but the commit's stated aim is that everything init writes names one binary, and this is the last scaffolded text that does not.

Required action: change both lines in both templates to name `prisma` (`a catalogs entry for prisma or {{pkg}}`, `pnpm dlx prisma@next orm init …`) and refresh the two affected snapshots. The same stale spelling appears in a code comment at `src/commands/init/detect-package-manager.ts:26-28`; worth the same one-line pass while the files are open, though it is not user-facing.

### S3-R5-1 — low — `.refs/prisma` `docs/reference/error-reference.md:146,148`

The retired-code entry for `CLI.INIT_SKILL_INSTALL_FAILED` still describes the mechanism the operator amendments removed. Line 146 says init "copies them into the agent directories by running `prisma skills sync` once, then writes a `postinstall` script that repeats the sync on every later install", and line 148 says "the postinstall retries on the next install". Init no longer writes that script, and amendment 2 says nothing may write it.

This is the same paragraph the slice rewrote in an earlier commit, so it is one edit that was missed rather than a document nobody touched. `skills/README.md` was corrected in this commit and now says init runs the sync once at scaffold time, so the two documents in this repository disagree about what init does.

It is worth fixing rather than leaving because the entry exists to explain to someone reading an old error code what replaced it. A reader following it will go looking for a script that is not there, and may add it back believing it is the design.

Required action: drop the two clauses about the postinstall from both sentences, and say what actually keeps the copies current — the per-command staleness check, which names the sync command when the copies fall behind. The rest of the entry (the retirement, the exit codes, the "a sync that fails no longer fails anything" point) is still correct.

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

**Slice 2, round 4 — `2c976bf`. SATISFIED.** Both round-3 findings are fixed, there is no collateral damage, and I have no new findings.

**S2-R3-1 is fixed.** The unreachable `command.startsWith("prisma ")` branch is gone from `portCommandString`, and the comment now describes what the function does rather than what it used to do: strings that already name this binary pass through, and the only spelling still rewritten is the package-runner prefix the legacy formatter emitted. I checked that removing the branch changes no behaviour — with `CLI_NAME` equal to `"prisma"` the first guard catches every string the deleted branch could have caught, and it returns them unchanged, which is the same answer the deleted branch produced. I also read the callers (`branch/errors.ts`, `bucket/errors.ts`, `git/errors.ts`, `project/presentation.ts`, and `project/errors.ts` itself) and the tests that assert on `prisma auth login` next actions; all of them feed strings that the first guard handles.

**S2-R3-2 is fixed**, and better than I asked. The title names `prisma-cli` again, and a comment above it records why: the assertion is about what this package publishes, not about what a user types. That is the note that stops the next reader "correcting" the assertion instead of the title.

No collateral damage. The commit touches exactly two source files plus the drive artifacts, and both source changes are the two fixes. The drive artifacts riding along is accepted, as instructed, and I am not filing it. Per the review brief I did not re-run the suites; the implementer's pre-halt run is the record.

**Slice 1, round 2 — `900db17`. SATISFIED.** One commit since the round-1 head, and it does exactly what S1-R1-1 asked.

`packages/0-shared/publish-surface/test/package-skills.test.ts` now proves the claim from the artifact. For each of the three target packages it deletes the staged `skills/` tree, runs `pnpm pack` the way the publish workflow does, unpacks the tarball, and reads `skills/prisma-8/SKILL.md` back out of it. Deleting first is what makes `prepack` the only possible source of what ships, and it also exercises `prepack`'s relative invocation of the sync script — the main-module guard I flagged in round 1 as never being tested under that path.

It is mutation-sensitive in both directions I named. Dropping `"skills"` from a manifest's `files` fails the packed-artifact test (the file is simply not in the tarball) as well as the manifest assertion. Dropping the `prepack` script fails it too, because nothing is left to re-stage the deleted tree. Neither mutation can pass by leaving a stale copy on disk, which was the whole weakness of the previous version.

The comparison is a real byte comparison, not a spot check: the packed skill directory's file list must equal the tracked tree's, every non-`SKILL.md` file must match byte for byte, and `SKILL.md` itself must equal the tracked source with only the `library` line rewritten to name the packing package. I checked the quoting matches rather than assuming — `stampSkillMetadata` writes `library: '<value>'` with single quotes and the test's expected replacement writes single quotes, so the equality is exact rather than accidentally lenient. The stamped `library_version` is asserted against the packed manifest's own version, and a separate case asserts the tracked source's stamp equals the repository root version, so the lockstep chain is checked end to end.

Two small things I looked at and am not filing. The test deletes the package's `skills/` directory in the working tree before packing; the directory is gitignored build output that `prepack` regenerates, so the only cost is that a failed pack leaves it absent until the next build. And each packed case carries a 60-second timeout because it shells out to `pnpm pack` — slower than the rest of the file, and worth it for what it proves.

Nothing else changed since round 1, so everything in that note still stands.

**Slice 3, round 2 — `26df6a2`. ANOTHER ROUND NEEDED**, on one low finding. The important part — S3-R1-1 — is fixed properly, and fixed in the direction round 2 of slice 2 said was right.

**S3-R1-1 is fixed.** `cliDevDeps` is now `['prisma@next']`, the package that actually declares the `prisma` bin. I verified that against the manifest in prisma-cli rather than taking it from the commit message: `packages/prisma/package.json` declares `"bin": { "prisma": "./dist/prisma.js" }`, and it declares `@prisma/cli-engine` in `dependencies`, so the engine-version probe still finds the exact version it needs.

Every string I was asked to check now names the same binary, and I traced each one in the tree rather than reading only the diff.

- The engine-version probe reads `node_modules/prisma/package.json` (`init-packages.ts`), and the comment in `init.ts` was corrected from "peer" to "dependency", which matches how `prisma` actually declares the engine.
- The emit spawn resolves `prisma/package.json` and reads the `prisma` bin entry (`init-emit.ts`), and all three of its error messages name `prisma` consistently.
- The `contract:emit` script is `prisma contract emit` (`hygiene-package-scripts.ts`), and the failed-emit next action (`EMIT_COMMAND` in `init-diagnostics.ts`) is the same string.
- The scaffold quick-reference prefix is `formatRunCommand(packageManager, 'prisma', '')`, so the generated document says `pnpm prisma contract emit` and so on.
- The direct sync invocation is `dlx prisma@next skills sync`, from the single constant `SKILLS_SYNC_PACKAGE`.
- The postinstall is `prisma skills sync || exit 0`, and its comment now explains `|| exit 0` in terms of the `prisma` binary being absent in a production install.

**The `formatSkillSyncCommand` note from round 1 is addressed.** The advice now runs the copy the project already has — `pnpm exec prisma skills sync`, `npm exec`, `yarn exec`, `bun run` — instead of fetching a fresh one with `dlx`. Deno keeps the `npm:` specifier, and the reason is recorded in the doc comment: Deno has no local-bin runner. The unit test asserts all five spellings.

**The integration test asserts one binary end to end**, which is the part that makes this hard to regress: "names one binary everywhere: the one it installed" checks in one case that the install command is `add -D prisma@next @types/node`, that the sync command is `dlx prisma@next skills sync`, and that the written manifest carries both `postinstall: prisma skills sync || exit 0` and `contract:emit: prisma contract emit`. Its comment states the failure it exists to catch — that naming `@prisma/cli` would leave both scripts calling a binary the project does not have, with `|| exit 0` hiding it. The offline shim was updated to materialise a `prisma` package with a `prisma` bin, so the test cannot pass against the old layout.

**The one finding, S3-R2-1**, is the last scaffolded text that still names the old package: the "Monorepo notes" section of both quick-reference templates. It is two lines in each file plus two snapshots, and it is the same class of thing the rest of the commit fixed.

The two implementer judgement calls are recorded as noted, not as findings: no migration entry for projects created before this change, and the repository-wide `prisma-cli` to `prisma` rename in prisma/prisma deliberately left undone. The second is why a great many `prisma-cli` strings remain in that package (`control-api/`, `orm/db/`, `commands/init/errors.ts`, `orm/config-section.ts`); I checked that they are all in that undone-rename set rather than in the set of strings init writes into a project, which is what this slice owns.

One thing for the orchestrator, not a defect: this branch is stacked on the slice-1 head from before the S1-R1-1 fix (`c95e2d02`), not on `900db17`. A merge of slice 1 followed by slice 3 keeps the fix, so nothing is at risk, but a rebase before opening the PR makes the diff show only slice 3's work.

**Slice 3, round 3 — `d18bc40`. SATISFIED.** S3-R2-1 is fixed and I have no new findings.

Both quick-reference templates now say "a `catalogs` entry for `prisma` or `{{pkg}}`" and "`pnpm dlx prisma@next orm init …`", so the scaffolded document names the package init actually installs and the command spelling that actually exists. The catalogs sentence is now true as well as consistent: init builds its catalog warnings from the packages it is about to install, and `prisma@next` is one of them, so `prisma` is the entry a reader should look for.

The comment in `detect-package-manager.ts` is updated in the same way, including the `bunx` example beside the `pnpm dlx` one.

All four snapshots are refreshed and they match the templates. I checked each of the four rather than sampling: mongo with PSL authoring, mongo with TypeScript, postgres with PSL, postgres with TypeScript. Each carries the same two rewritten lines with the target's own package name interpolated, and nothing else in the snapshots moved. A grep across the templates, the comment, and the snapshot file finds no remaining `@prisma/cli@next` or `prisma-cli`.

Per the review brief I did not re-run the suite; the implementer reports 1443 tests green and a clean typecheck.

**Slice 2, round 5 (CI repair) — `ce4b9ea`, `d8a3aeb`. SATISFIED.** Both repairs do what they claim and neither weakens anything.

**The cli-engine revert is exact.** `git diff origin/main...HEAD -- packages/cli-engine` produces nothing, so the branch no longer changes that package at all. I also checked the wider blast radius: `git diff --name-only origin/main...HEAD -- packages` lists nothing outside `packages/cli`, so the branch touches one package and the engine-version check has nothing to object to.

Losing the two renamed lines is acceptable. Both are doc comments in `execution/help.ts` that use an example invocation to illustrate a rule — one about a bare group invocation being a help request, one showing the shape of a help header. Neither is printed, and the engine renders whichever binary name the host CLI gives it, so the comments were always illustrative rather than authoritative. Publishing 0.2.1 to reword two comments would be a poor trade. The residue is that a reader of `help.ts` sees `prisma-cli` in two examples while the CLI that consumes it says `prisma`; that belongs on the list of deliberate survivals in the PR body, not in a finding.

**The Windows failures were fixture-only, and I verified that rather than accepting it.** I read all seven files in `packages/cli/src/lib/skills/` looking for the three shapes that break on Windows — a hardcoded `/` in a path, a regular expression assuming `/`, and a `startsWith` against a slash-prefixed path. There are exactly two places that mention `/` at all, and both are correct:

- `resolve.ts:58` builds its `node_modules` marker as `${path.sep}node_modules${path.sep}${packageName.split("/").join(path.sep)}`. The forward slash there is the separator inside an npm scoped package name, which is `/` on every platform; it is translated into the platform separator before being compared against a real path.
- `project-root.ts:168` splits a workspace glob on `/`. Workspace patterns in `package.json` and `pnpm-workspace.yaml` are always written with forward slashes, and each segment is then joined with `path.join`.

Everything else — the harness directories, the package skills directory, the state file, every read, copy and delete in `sync.ts` and `status.ts` — goes through `path.join`. `HARNESS_SKILL_DIRS` is declared with forward slashes but is only ever an argument to `path.join`, which accepts them on Windows. So the claim holds: production code has no separator assumption a Windows user would hit.

**Both tests keep their point.** In `skills-pnp.test.ts` the fake filesystem layer now converts the incoming path to forward-slash form before testing it against the virtual zip prefix. On macOS and Linux that conversion is a no-op, so the existing proof is unchanged; on Windows it lets the remap fire for paths the production code built with `path.join`. What the fixture proves is untouched: a path that does not begin with the virtual prefix is still passed through unremapped, so a sync that built a `node_modules` path itself would read nothing and fail, and the reads still have to go through `node:fs/promises` to be seen at all.

In `skills-workspace-scan.test.ts` only the comparison changed. The test still asserts the exact set of directories the walk read — `packages` and `packages/group`, and nothing else — still caps the whole status read at fewer than twelve directory reads, and still asserts that no `dist` directory was read. That last check compares against `${path.sep}dist`, so it was already separator-aware and stays correct on both platforms. Normalising the recorded paths before comparing them cannot make the assertion pass with a different set of directories, because the set is compared by equality, not by containment.

Per the review brief I did not re-run the suite; the implementer reports 1040 passed with the one known skip and a clean typecheck.

**Slice 3, round 4 (CI repair) — `4c9ce87`. SATISFIED.** The commit does what it says, the test still proves what it existed to prove, and nothing else moved.

The harness now plants `node_modules/prisma` with a `prisma` bin at `bin/prisma.mjs`, which is the package init installs and the one `init-emit.ts` resolves. That is the whole cause of the failure: init resolved `prisma/package.json`, found nothing, and settled at exit 5 with `CLI.INIT_EMIT_FAILED` before either case could assert anything. The doc comment at the top of the file, the describe title, and the first case's title were updated to name the same package, so the file no longer describes a layout it does not create.

The proof is intact, and it is the assertion on the spawned script that carries it: the recorded `process.argv[1]` must be the real path of `node_modules/prisma/bin/prisma.mjs` inside the scaffold. Nothing else can write that sentinel file, so an init that emitted in process — the regression this suite exists to catch — still fails here. The rest of the first case is unchanged: argv equal to `['contract', 'emit']`, the child's working directory equal to the scaffold, exit code 0, and `"contractEmitted":true` in the settled frame. The second case is untouched and still pins the failure path: exit 5, the `CLI.INIT_EMIT_FAILED` code, the child's stderr marker carried into the diagnostic, and "exited with code 3".

Nothing else is touched. The commit is one file, ten lines replaced by ten, and every one of them is a name change.

**On the Integration (2/4) failure.** I did not read the CI logs, and I did not need to in order to check the reasoning. The branch's complete file list against `origin/main` contains no `db-verify` file and no database command path at all; outside the CLI package's `src` and `test` trees it touches exactly two test files, the init emit e2e and the init skill-distribution integration test. So the failing file is in an area this branch does not modify and does not import, which is what the repository's rule for classifying a CI failure asks you to establish. Treating it as a worker-crash flake is sound on that evidence. The usual caveat applies: if it repeats on a re-run, it stops being a flake and wants a real look.

**Slice 2, round 6 (operator amendments) — `4cf056e`, `f237e32`. SATISFIED.** Both commits match the amendments and I have no new findings.

**Amendment 4: the rewriter is gone, and nothing is left feeding it an old spelling.** `renameAppCopy`, `toCurrentCommandLine`, `COMMAND_PREFIXES` and `LEGACY_CLI_NAME` no longer appear anywhere in the package — I grepped for all four across `src` and `tests`. `fromLegacyCliError` now does only structural work: the flat code becomes `SERVICE.<code>`, a free-text `fix` becomes a user-choice action, and each `nextSteps` line becomes a run-command action. Every piece of copy — summary, why, fix, command lines — passes through untouched.

**The structural-only claim holds, and removing the filter is safe.** This was the part worth checking, because the old code only turned a `nextSteps` line into a run-command action when it started with a binary name; without the filter, any line at all becomes a command the user is told to run. So I enumerated the producers instead of assuming. `fromLegacyCliError` is called from four places, all in `service/target.ts`, and they feed exactly three builders: `computeConfigErrorToCliError`, `projectApiError` and `projectResolutionErrorToCliError`. Every `nextSteps` entry any of them emits is a `prisma …` command line, or the list is empty — the compute-config cases emit `prisma service <command>` and per-target variants, the project-resolution cases emit `prisma project list`, `prisma project link …`, `prisma auth workspace use …` and the recovery commands built by `buildProjectRecoveryCommands`, and `projectApiError` emits none. Nothing prose-like or URL-like reaches this path, so the filter had nothing left to drop and its removal changes no output.

**Producers were fixed rather than papered over.** `domain-guidance.ts` writes `prisma service domain retry/show` at all five call sites, and `compute-config.ts` says "Service target" and "service target" in the two places that said "App". A sweep for `prisma-cli ` and for the `app` noun in guidance strings across `src` finds no producer still on the old spelling; what survives is the known list — the update-check entrypoint matcher and cache directory, the sign-in analytics tags, and the `prisma/prisma-cli` repository URLs, none of which are command copy.

**Coverage did not go down when `service-legacy-errors.test.ts` was deleted.** The structural conversion is still pinned by `service-compute-config.test.ts`, which asserts the full `nextActions` array — the fix as a user-choice action followed by one run-command per configured target — and the `SERVICE.` code prefix and rewritten summary; and by `service-domain-wait.test.ts`, which asserts the guidance action verbatim. Both files also assert that the serialised error never contains `prisma-cli app `, so the old spelling cannot creep back in unnoticed. The deleted file existed only to pin the rewriter, which no longer exists.

**On keeping `portCommandString`: the implementer's argument is right.** It is not spelling rewriting, and the difference is visible in what produces its input. `formatPrismaCliCommand` defaults to the package invocation and emits `npx -y @prisma/cli@next <args>` today — a current producer, not a legacy one. `portCommandString` turns that into `prisma <args>` for display, which is a choice of invocation style, not a translation from an old name to a new one. Amendment 4 removes the layer that let producers keep writing yesterday's spelling; this converts today's package-runner form into today's binary form. One note for whoever owns the naming question: the regular expression matches `@prisma/cli@…` while the producer builds its string from `PRISMA_CLI_PACKAGE_SPEC`, so the two would have to change together if that package name ever becomes `prisma`. They agree today.

**Amendment 3: gitignoring is self-contained.** `replaceTree` writes a `.gitignore` containing `*` into each managed skill directory after copying the tree. Nothing in `packages/cli/src/lib/skills/` reads or writes a root `.gitignore`; the only root-gitignore writer in the package is the unrelated local project pin in `lib/project/local-pin.ts`, which predates this work and has nothing to do with skills. The stamp and the orphan scan both key on `SKILL.md` alone, so the extra file is invisible to them, and the new test proves it rather than asserting it: after a sync, every harness copy has the `.gitignore`, the list reports `upToDate` with no orphans, and a second sync synchronises and prunes nothing.

Two things about that file worth knowing rather than fixing. A bare `*` also ignores the `.gitignore` itself, which is the intended effect — the whole managed directory disappears from git's view — but it does mean nothing about the mechanism shows up in `git status`. And an ignore file does not untrack anything already committed, so a project that committed synced skills before this change keeps them tracked until someone removes them.

**Amendment 2: nothing edits the user's package.json.** The skills code only ever reads a `package.json` — for workspace patterns, for a member check, and for a package's version. Sync's `next` output gained one advisory that shows the postinstall one-liner as something the user may add themselves, which is exactly what the amendment permits, and it appears only when the project actually has skill source packages installed. The test runs the real command and compares the manifest byte for byte before and after, so a future change that starts writing the manifest fails here. `docs/product/output-conventions.md` now states the same model in one paragraph: the notice is the mechanism, the gitignoring is confined to the managed directories, and the postinstall is the user's own choice.

Per the review brief I did not re-run anything; the implementer reports 1037 passed with the one known skip, a clean typecheck and clean lint.

**Slice 3, round 5 (operator amendments) — `0800daec`. ANOTHER ROUND NEEDED**, on one low finding in a document. The code side of amendments 1 and 2 is done properly.

**No postinstall writing.** `SKILLS_SYNC_SCRIPT` is deleted from `hygiene-package-scripts.ts`, and `mergePackageScripts` survives with `REQUIRED_SCRIPTS` as its default, so `contract:emit` is still merged with the same collision handling — a user's own script of the same name still wins and produces a warning. The scaffold now calls `mergePackageScripts(working)` with no second argument, so there is no path that could pass a skills script in. A grep for `postinstall` across the CLI package's source finds nothing.

**No skill entries in the root gitignore.** `SYNCED_SKILL_GITIGNORE_ENTRIES` is deleted, `mergeGitignore` keeps `REQUIRED_GITIGNORE_ENTRIES` as its default, and the scaffold's conditional list is gone — it now merges the base entries only. That also removes the last place where `--skip-skills` had to change what was written to a file the user owns.

**Exactly one skills touchpoint remains.** `syncAgentSkills` is called from one place in `init.ts`, guarded by `inputs.installProjectSkill`, which is `!flags.skipSkills`. The retired-skill cleanup (`legacySkillDirs`) is the only other skills-related thing init does, and it is unchanged and unconditional — it was unconditional before this commit too. That is defensible: it removes directories left by earlier generations of the Prisma skills, which is a repair rather than wiring, and the integration suite still exercises it.

**The advice strings say the right thing now.** The failed-sync warning no longer promises a postinstall retry; it says the user is pointed back at the sync, and names the command. The skipped-sync warning is unchanged and already named the command. `formatSkillSyncCommand` still produces the per-manager form that runs the installed copy. No string anywhere in init mentions a postinstall.

**The tests were rewritten to prove the absence, not just to stop asserting the presence.** `init-scaffold.test.ts` keeps a case under the heading "the skill-sync wiring it does not write" that asserts no `postinstall` key and no `skills/prisma-8/` line in the gitignore, and the integration suite has its own "writes no skills wiring into the project" case doing the same against the real binary. The rest of the integration suite still pins what matters: exactly one sync invocation, one binary end to end (`add -D prisma@next @types/node` plus `dlx prisma@next skills sync` plus `contract:emit: prisma contract emit`), no `skills add` and no `prisma/prisma` fetch, the retired-directory cleanup, and nothing spawned at all under `--skip-skills`. The journey harness comment was corrected too — it explained `--skip-skills` in terms of the GitHub tag fetch that no longer happens.

**The one finding, S3-R5-1**, is `docs/reference/error-reference.md`, which still tells the reader init writes a postinstall that repeats the sync on every install. `skills/README.md` was corrected in the same commit, so the two documents now disagree.

Per the review brief I did not re-run anything; the implementer reports 1436 CLI tests, 17 of 17 integration, 115 of 115 e2e, and a clean typecheck.

**Slice 3, round 6 — `373493dc`. SATISFIED.** S3-R5-1 is fixed and I have no new findings.

The `CLI.INIT_SKILL_INSTALL_FAILED` entry now says init copies the skills in by running `prisma skills sync` once at scaffold time, and the second paragraph names the per-command staleness notice as what keeps the copies current, including that it names the sync command to run. Both clauses about a postinstall are gone. The rest of the entry — the retirement itself, the old GitHub fetch it describes, and the exit codes — is unchanged and still correct.

The commit is that one file, two lines replaced by two. Nothing else moved.

**Leaving `docs/oss/pr-triage.md` alone is the right call.** That line is part of a checklist for reviewing an incoming pull request for supply-chain risk: it tells a reviewer to read `package.json` script entries closely, naming `preinstall`, `install`, `postinstall` and `prepare` as the ones that run code on install. It is about a class of manifest entry in any pull request, not about anything this project ships, so it stays true whatever init does. Editing it would have been the mistake.

## Orchestrator notes

### Init slice — Round 1 (engine groundwork)

Range reviewed: `cc33470..f72503c` (`ba48d46`, `f72503c`). Suites run locally: `pnpm --filter @prisma/cli-engine test` → 35 files, 829 tests passed, `tsc --noEmit` clean; `packages/cli` `tests/skills-check.test.ts` → 20 passed (that file calls `loadConfig(cwd)` and is affected by the walk).

The ruled semantics are implemented as written. `root` is reserved (`config-loader.ts:70`), validated as an optional boolean (`config-loader.ts:288-292`), stripped from sections so it can never be reported as `CLI.CONFIG_UNKNOWN_SECTION` (`config-loader.ts:258`), surfaced on `LoadedConfig` (`runtime.ts:196-200`), and the reserved-keys doc comment names it the first engine-owned file-level setting. The walk lives only in the resolve step (`config-loader.ts:300-333`); evaluation, marker check, and section validation are untouched; `--config` bypasses discovery; no config anywhere returns exactly the previous absence shape.

**INIT-R1-1 — major — docs/architecture/cli-engine-requirements.md:166,168,170**
R10 is the repo's authority on the config contract, and it now states the opposite of the code in three places. Line 166: "By discovery: `prisma.config.ts` in the current directory, that directory only, never walking up". Line 168: "Those five are every file-level config diagnostic there is" and "Each of the six means one thing" — `CLI.CONFIG_ROOT_INVALID` is a sixth file-level code. Line 170: the section-name constraint paragraph lists `extends` and `$`-prefixed names only, and `root` is now a third reservation of a genuinely different kind. The brief's mechanical obligations also call for recording the `root: true` semantics in a doc, since the flag is public surface. Fix all three paragraphs in this PR.

**INIT-R1-2 — major — packages/cli-engine/tests/config.test.ts:167-173 (and 62, 72, 240, 250, 196, 369, 377, 572)**
Every fixture-directory test now runs an unbounded walk to the filesystem root, so its result depends on no `prisma.config.ts` existing anywhere above the checkout. The comment at line 167 says "Fixture trees for the walk carry `root: true` at their top so the search can never escape into a real ancestor directory" — that holds only for `fixtures/config/walk/`. `marked`, `root-false`, `root-invalid`, `unmarked`, `extends-key`, `extends-remote`, the `FIXTURES` root itself, and the two temp trees under `tests/tmp/` are all unanchored and climb through `packages/cli-engine`, the repo root, and out to `/`.

Verified empirically with the built loader: a directory two levels above a valid nested config, holding an unmarked Prisma 7 file, took over the load and returned `CLI.CONFIG_MISSING_MARKER` naming the ancestor. The same mechanism applied to `fixtures/config/prisma.config.ts` or a repo-root `prisma.config.ts` flips roughly a dozen assertions. This branch is the one that starts scaffolding `prisma.config.ts` files (init's own e2e, and dogfooding the scaffold at the repo root), so the hazard is immediate, not theoretical. Fix: give the tests that are not about discovery an explicit `configPath` — which bypasses the walk — or run them in temp trees, and correct the comment at line 167 to say which trees are actually anchored.

**INIT-R1-3 — medium — packages/cli-engine/src/config-loader.ts:310, 313, 328**
The walk climbs the logical path (`resolve(cwd)` then repeated `dirname`), and the anchor's path is built from that logical chain, so a symlinked cwd searches the wrong ancestors and reports a path that is not the file's real one. Verified: with `link -> real/app` and a `root: true` config at `real/prisma.config.ts`, `loadConfig(link)` walked `link` → its logical parents, never saw the config, and returned `{path: ".../link/prisma.config.ts", sections: {}}`. The ruling is that the chosen anchor's real path surfaces on `LoadedConfig.path`. In practice `process.cwd()` is already resolved on POSIX, but `loadConfig` also takes a caller-supplied directory (`skills-check.ts:130`, every test). Fix: resolve the base with `realpathSync` and fall back to `resolve(cwd)` when it throws (a cwd that no longer exists).

**INIT-R1-4 — medium — packages/cli-engine/src/execution/needs.ts:233-241 with config-loader.ts:258**
`root`'s exemption from `CLI.CONFIG_UNKNOWN_SECTION` lives entirely in the loader's `sectionsOf` filter — on the far side of the seam that `config.test.ts:337` ("a loader that checks nothing does not reopen the closed set") exists to protect, and that `needs.ts:207-211` explains at length: the loader is a `Runtime` member a host supplies, so a check that lives there holds only while every host writes one. A host loader that hands the file's keys straight through — including `createTestCli`'s `spec.loadConfig`, which callers write by hand — fails the run on `'root'`. Narrow fix: also skip `root` in `unknownSections`, leaving the existing `extends`/`$`-key reporting alone.

**INIT-R1-5 — minor — packages/cli-engine/src/config-loader.ts:70, 258, 289**
The literal `"root"` is written in three places while `$prismaConfig` has `MARKER_KEY`. Add a `ROOT_KEY` const and use it in all three (and in the `needs.ts` fix above, if INIT-R1-4 is taken).

**INIT-R1-6 — minor — packages/cli-engine/src/config-loader.ts:163-177**
The shape of `CLI.CONFIG_ROOT_INVALID` matches its siblings: dotted `CLI.CONFIG_*` code, `severity: "error"`, path-leading summary, a `why` (as `CONFIG_MISSING_MARKER` and `CONFIG_NOT_FOUND` have), one `user-choice` next action, and `where: { path }`. One gap: the summary does not say what was found, where `unsupportedVersionDiagnostic` reports the version it saw. `root: "yes"` reads back as "sets 'root' to a value that is not a boolean" without naming the value. Include the offending value or its type.

**INIT-R1-7 — minor — packages/cli-engine/tests/config.test.ts:174-236, 240**
The module comment at `config-loader.ts:10-14` asserts two behaviors no test pins: that a candidate which fails to evaluate or lacks the marker still counts as a candidate and surfaces its diagnostics when it ends up topmost, and — the flip side — that a broken nested candidate's diagnostics are dropped when a valid topmost wins. The second is the monorepo consequence the operator asked about, and it should be recorded in a test rather than only in prose. Separately, the test at line 240 is named "root: false ... does not stop the walk", but its fixture has no ancestor config, so nothing in it exercises the walk continuing.

**INIT-R1-8 — minor — packages/cli/src/skills-check.ts:123-131**
Unchanged code, changed behavior. `isDisabledInConfig(cwd)` calls `loadConfig(cwd)` with no config path, so `skills: { check: false }` written in a parent now applies from subdirectories — the direction the handoff's finding 2 wanted, and its tests still pass (20/20). But its doc comment reasons about cost as "a TypeScript transpile", singular; the call can now transpile one config per ancestor that has one. Update the comment, and record in the handoff that half of finding 2 (the workspace-root opt-out) is resolved by this walk while the `--config` half is not.

#### Decision verdicts

**1. A candidate that fails to evaluate or lacks the version marker counts as a non-root candidate; the walk continues and its diagnostics surface if it ends up topmost. — escalate to operator.**
The implementation matches the letter of the ruling, and refusing to guess about an unreadable file is consistent with the loader's existing stance. What needs the operator's eye is the reach. Verified: an unmarked Prisma 7 config two levels above a valid nested v8 config wins, and the run fails with `CLI.CONFIG_MISSING_MARKER` naming a file the user may not own. Because the walk runs to the filesystem root with no repository boundary, the exposure is not limited to a monorepo root — any Prisma 7 project above cwd (a `~/work/prisma.config.ts`, a parent checkout) breaks every nested v8 project below it, and the escape hatch is `root: true`, which only `prisma init` writes, so repositories that predate init are exactly the ones exposed. The operator ruled on "a monorepo may hold several `prisma.config.ts` files"; they did not rule on the walk leaving the repository. Two adjustments are worth a decision: (a) prefer the topmost candidate that carries the marker, falling back to a broken candidate only when there is no valid one anywhere, which keeps the deliberate Prisma 7 fail-early behavior for the case where the v7 file is the only config; (b) stop the walk at a repository boundary (`.git`) or the home directory. Two further consequences to state to the operator either way: `prisma.config.ts` is executable code, so the walk runs — and then discards — every ancestor config's top-level side effects; and a broken nested config is silent whenever a valid topmost wins.

**2. A non-boolean `root` refuses the whole file (empty sections plus one file-level diagnostic). — sound.**
It is the same shape as `CONFIG_MISSING_MARKER`, `CONFIG_VERSION_UNSUPPORTED`, and `CONFIG_UNREADABLE`: `fileLevelConfig` returns no sections and one `section: null` diagnostic, which `checkNeeds` turns into the run's error with the rest attached. A file whose file-level settings the loader cannot interpret should not be partially read. One consequence to keep in mind (covered by INIT-R1-7): a non-boolean `root` cannot stop the walk, so `root: "true"` written as a string keeps walking, and the diagnostic is only visible if that file ends up the anchor.

**3. `root: false` surfaces as `false`; absent `root` leaves the property absent. — sound.**
`root === undefined ? loaded : { ...loaded, root }` keeps the property off the object rather than setting it to `undefined`, which is what `LoadedConfig`'s optional `readonly root?: boolean` implies and what the existing whole-object `toEqual` assertions depend on. Both cases are pinned by tests (`config.test.ts:196-215` and `240-246`).

**Verdict: ANOTHER ROUND NEEDED** — the requirements doc still says discovery never walks up and that five file-level diagnostics are all there are (INIT-R1-1), the fixture tests now depend on no config existing above the checkout on the machine running them (INIT-R1-2), and decision 1's reach past the repository boundary needs the operator's ruling before this lands.

### Init slice — Round 2 (init command, agent-group deletion, sync rulings)

**Verification run locally:** `pnpm --filter @prisma/cli test` → 60 files, 901 passed / 1 skipped, exit 0. `pnpm --filter @prisma/cli typecheck` → clean. `pnpm lint` could **not** be run: biome 2.4.16 aborts with `fatal runtime error: stack overflow` on every input in this worktree, including a single unrelated file (`src/cli-name.ts`), so the crash is environmental and not caused by these commits. Lint conformance is unverified.

**Rulings confirmed implemented:** the postinstall hint is gone from `next()` (`commands/skills/presentation.ts:41`); no `.gitignore` is written anywhere (`lib/skills/sync.ts:108`); the `agent` group is gone with no dangling imports (typecheck passes; `src/commands/agent/` and `src/lib/agent/setup-status.ts` deleted; the only surviving `agent-skills` strings are unrelated fixture text in `packages/cli-engine/tests/package-install-matrix.test.ts`); the refusal path is real and tested; the six smaller owed fixes are all present (`skills-check.ts:39-49`, `:104-107`, `:133`, `:144-157`, `lib/skills/unquote.ts`, doc unwrapping). No banned words appear anywhere in the added prose, and the changed doc paragraphs are unwrapped. mount-coverage and e2e-coverage are consistent with the new surface.

#### INIT-R2-1 — major — `packages/cli/src/commands/init.ts:182`

`init` exits 1 when `package.json` exists but cannot be written. `readFile` is guarded, `JSON.parse` is guarded, the skills sync is guarded — the `writeFile` is not, so an `EACCES` (read-only file, restricted directory, some CI checkouts) escapes the handler. Reproduced against the built binary: a chmod-444 package.json yields exit=1 with `CLI.INTERNAL_ERROR`. This breaks the "always exit 0, a failure is a diagnostic" ruling, and the failure is reported as an internal error rather than as guidance. Wrap the write the same way the read is wrapped and return an `INIT.PACKAGE_JSON_UNWRITABLE` diagnostic with `APPEND_ADVICE`.

#### INIT-R2-2 — major — `packages/cli/src/commands/init.ts:150-155,180`

A non-object `scripts` value is silently destroyed. When `manifest.scripts` is not a plain object the code falls back to `{}` and then assigns `manifest.scripts = { ...scripts, postinstall }`, overwriting whatever was there. Reproduced: `{"scripts": "oops"}` in, `{"scripts": {"postinstall": ...}}` out, exit 0, no diagnostic. The ruling is "never touch anything else in the file". A malformed `scripts` is still the user's data. Treat a non-object `scripts` like a foreign postinstall: leave the file untouched, report `kept`/`skipped` with a diagnostic. No test covers this case.

#### INIT-R2-3 — major — `packages/cli/src/commands/init.ts:13,221`

`init` drops the unmanaged-directory refusal. It imports `packageReports` and `versionConflictDiagnostics` from `commands/skills/sync` but not `unmanagedDirectoryDiagnostics`, so the diagnostic added in `fd999a4` — the one that tells the user why the packaged skill was not installed — never fires through `init`. Worse, the human output is actively wrong: `syncPresentations` renders no refusal block at all (`commands/skills/presentation.ts:42-67`), so with `refused` non-empty and `synced`/`pruned` empty, `syncSummary` prints "Agent skills are up to date." (`presentation.ts:18-20`). A user who runs `prisma init` over a hand-written `.claude/skills/prisma-8` is told everything is fine while the packaged skill was never installed there. Add `unmanagedDirectoryDiagnostics(outcome.refused)` to `syncSkillsStep`'s diagnostics, and consider making the refusal visible in the shared sync presentation (a `Refused` table) rather than only in diagnostics.

#### INIT-R2-4 — medium — `packages/cli/src/lib/skills/status.ts:213-214`

A directory with no `SKILL.md` at all is classified `unmanaged`, so sync refuses it permanently. `stampState` returns `unmanaged` whenever the stamp read fails and the directory merely exists. A directory containing no `SKILL.md` is not somebody's skill — it is most often *sync's own interrupted copy*: `replaceTree` removes the destination and then copies file by file (`lib/skills/sync.ts:108-111`), so a `Ctrl-C` mid-copy leaves a partial tree that may not yet contain `SKILL.md`. Before this change that state read as `absent` and the next sync repaired it; now it reads `unmanaged`, sync will never touch it again, `findOrphanedSkills` ignores it too (`status.ts:236` only considers directories holding a `SKILL.md`), and the user is told to move or remove a directory the CLI itself left behind. The file-header comment on `sync.ts:1` still claims an interrupted sync leaves whole trees, which is not true within a single skill. Suggested fix: return `absent` when `SKILL.md` does not exist, and reserve `unmanaged` for a `SKILL.md` that exists but is unstamped or foreign-stamped. That keeps the data-loss protection (the finding was about a real user-authored `SKILL.md`) and restores self-healing.

#### INIT-R2-5 — medium — `packages/cli/src/lib/skills/sync.ts:108-111`

The `.gitignore` written by an older CLI only disappears when the skill happens to be resynced. `replaceTree` runs only for targets in state `stale` or `absent`. A project already synced at the current version keeps the `*` `.gitignore` inside every managed skill directory indefinitely, so its skill copies stay invisible to git while a freshly-synced project's copies do not — the same CLI version producing two different git behaviors depending on project history. The test at `tests/skills-sync.test.ts` ("removes one an older CLI wrote") only proves the resync case. Either delete a stray `.gitignore` on the no-op path, or state in `docs/product/output-conventions.md` that the leftover is expected until the next version bump.

#### INIT-R2-6 — low — `packages/cli/src/commands/init.ts:130`

A `package.json` with a UTF-8 BOM is treated as unparseable, so the hook is silently skipped (diagnostic only). Reproduced: BOM input → `{"outcome":"skipped"}` + `INIT.PACKAGE_JSON_UNREADABLE`, exit 0. Exit-code discipline holds, but BOM-prefixed manifests are common on Windows and this is a one-line fix (strip the BOM before parse, re-prefix on write).

#### INIT-R2-7 — low — `packages/cli/src/commands/init.ts:181-186`

Line endings are not preserved. Only the trailing newline and the indent width are carried over; a CRLF manifest comes back LF. Reproduced: CRLF in, LF out. That is a whole-file diff for a Windows repository from a command whose promise is "never touch anything else in the file". Detect `\r\n` alongside the indent and rejoin.

#### INIT-R2-8 — low — `packages/cli/src/commands/auth/agent-setup-tip.ts:26`

The post-login tip's status read is unguarded, and it scans more than it needs. `resolveAgentSetupTipCommand` is awaited at `commands/auth/login.ts:148`, *after* the credential has already been stored; if `readSkillsStatus` throws, login reports failure for a login that in fact succeeded. The deleted `readPrismaAgentSetupStatus` had its own `try/catch` (two of them), so this is a guard lost in the rewrite. Wrap it and return `null`. Separately, the call omits `{ orphans: false }` even though the tip never reads `status.orphans` — the option added in `0fcd704` for exactly this reason.

#### INIT-R2-9 — low — `packages/cli/src/adapters/local-state.ts:21-22,42-43,82-83`

Dead local state. `readAgentSetupPromptDismissedAt` / `setAgentSetupPromptDismissedAt` were deleted, but the `agent: { setupPromptDismissedAt }` field is still declared, defaulted, and parsed, with no reader or writer left in the tree. Remove the field with the group that owned it, or note why the persisted shape must stay for forward compatibility.

#### INIT-R2-10 — low — `docs/product/output-conventions.md:106`

Docs do not cover the two behaviors this round introduced. Nothing in `docs/` mentions the `unmanaged` state or the refusal rule, even though it is a new user-visible outcome of `skills sync`, a new value in `skills list`'s State column, and a new `refused` array in the JSON result. The same edit also removed the only sentence explaining how synced copies relate to git without replacing it, so the docs are now silent on the fact that the copies are ordinary tracked files. `command-principles.md` gains a good `init` entry; the preview-scope sentence just above it still omits both `skills` and `init` — the `skills` omission predates this PR, the `init` one does not.

#### INIT-R2-11 — nit — `packages/cli/src/skills-check.ts:39-45`

The opt-out fix reads the same two things twice. `maybeWriteSkillsStaleNotice` calls `findProjectRoot` then `readSkillsCheckDisabled`, and `readSkillsStatus` immediately does both again (`lib/skills/status.ts:80-81`). The early-exit saving is real and the ruling is satisfied; passing the already-resolved root (or the already-read flag) into `readSkillsStatus` would avoid the duplicate ancestor walk on the path that does not exit early.

#### Decision verdicts

**A — post-login tip repointed to `skills sync` — sound.** `skills sync` is the right target rather than `init`: the tip fires only when copies are stale, and offering `init` there would offer to edit `package.json` as a side effect of logging in. The four suppressions match the check's own contract. Two defects in the implementation are filed as INIT-R2-8; neither changes the decision.

**B — `unmanaged` targets do not count as outdated — sound.** A notice naming a directory sync will never touch would be unactionable noise repeated on every command, and `skills list` still reports the true per-target state. One presentational consequence to accept or fix: `skills list` prints "Agent skills are up to date." while a target reads `unmanaged`, which is the same over-claim as INIT-R2-3 in a less harmful place. A one-clause summary variant ("up to date; 1 directory is not managed by this CLI") would close it.

**C — `"kept"` for a foreign postinstall, unparseable treated as missing — sound.** Both land in "report and leave alone", which is what the ruling asks for, and `kept` carries the user's actual script in the JSON so a caller can see what blocked it. The reservation is scope, not shape: the unparseable bucket currently swallows BOM files (INIT-R2-6), and the non-object `scripts` case bypasses this discipline entirely instead of joining it (INIT-R2-2).

**D — sync at the discovered project root, edit cwd's `package.json` — sound.** The ruling names cwd's `package.json` explicitly, and the skill directories genuinely belong to the workspace root, so the split is correct rather than accidental. It is also visible: `syncPresentations` prints a `project` field with the root it used. Worth one sentence in the `init` help description saying the hook lands in the current directory while the skills land at the workspace root, since the two paths can differ.

**E — the browser success page's `npx skills add prisma/skills` copy button — escalate to operator, recommend deleting it.** Confirmed still present at `packages/cli/src/auth/login.ts:571` and `:582` (asserted at `tests/auth-login.test.ts:61`). It is the same third-party installer ecosystem the `agent` group wrapped, and it is now the only surface in the product still promoting it. After this PR the CLI's answer to "using an AI coding agent?" is `prisma init`, so the page contradicts the CLI in the one place a brand-new user is most likely to look. It is a separate surface and out of the stated scope, so it is the operator's call whether it dies here or in a follow-up — but it should not survive the group indefinitely.

**ANOTHER ROUND NEEDED** — three defects must be fixed in this PR before the slice is correct: `init` exits 1 on an unwritable `package.json` (INIT-R2-1), it silently destroys a non-object `scripts` value (INIT-R2-2), and it reports "up to date" while dropping the unmanaged-directory refusal the round was built to add (INIT-R2-3).

### Init slice — Round 3 (verification)

**Verification run locally:** `pnpm --filter @prisma/cli test` → 61 files, 911 passed / 1 skipped, exit 0. `pnpm --filter @prisma/cli typecheck` → clean. `pnpm lint` still cannot be run: biome aborts with `fatal runtime error: stack overflow` on every input in this worktree, unchanged from round 2, so lint conformance remains unverified. Everything below was exercised against the built binary (`packages/cli/dist/cli.js`) in throwaway fixture projects with a stub `@prisma/orm-postgres@8.1.0` shipping one skill, not read off the diff.

The login success page's `npx skills add prisma/skills` button is untouched by these seven commits (`packages/cli/src/auth/login.ts:571,582` unchanged); it stays with the operator and is not reviewed further.

#### Per-finding verdicts

**INIT-R2-1 — fixed.** chmod-444 `package.json`: exit 0, `postinstall: {"outcome":"skipped","script":null}`, diagnostic `INIT.PACKAGE_JSON_UNWRITABLE` with the append advice, file bytes unchanged. The skills step still ran and synced. Covered by a test that is skipped on Windows for the right reason.

**INIT-R2-2 — fixed.** `{"scripts": "oops"}`: exit 0, `outcome: "kept"`, diagnostic `INIT.SCRIPTS_NOT_AN_OBJECT`, file byte-identical (verified with `xxd`). `scripts: null` also lands in this branch rather than being overwritten, which is the conservative side.

**INIT-R2-3 — fixed.** With a hand-written `.claude/skills/prisma-8/SKILL.md`: `prisma init` prints `Synced 1 skill; 1 directory is not managed by this CLI.`, an `Unmanaged skill / Left untouched in` table, and the `SKILLS.UNMANAGED_DIRECTORY` diagnostic; `prisma skills sync` prints `Agent skills are up to date; 1 directory is not managed by this CLI.` with the same table and diagnostic, and JSON carries `refused: [{"skill":"prisma-8","dirs":[".claude/skills"]}]`. No unqualified "Agent skills are up to date." appears on either path. `skills list` gained the same clause, which also closes the decision-B presentational over-claim from round 2. The user's file was left byte-for-byte intact.

**INIT-R2-4 — fixed, with one narrow regression (see INIT-R3-2).** A partial copy (`.claude/skills/prisma-8/references/usage.md`, no `SKILL.md`) is now classified `absent` and fully rewritten by the next sync: `synced` lists all four harness dirs, `refused` is empty, the stale partial file is gone, and the stamp reads 8.1.0. A real user-authored `SKILL.md` still reads `unmanaged` and is refused, because `readSkillStamp` returns an empty stamp (not `null`) for any readable file — so the `stamp === null → absent` rule only catches files that cannot be read at all. `findOrphanedSkills` is unaffected: it only walks directories that hold a `SKILL.md`, so the partial tree is never a prune candidate, and the repair path owns it. The `sync.ts:1` header comment now describes the real behavior.

**INIT-R2-5 — fixed.** A project already current at 8.1.0 with a `*` `.gitignore` planted in two managed copies: `skills sync` removed both, `synced` and `pruned` stayed empty, and `SKILL.md` kept the same md5 before and after — cleaned on the no-op path without a resync. See INIT-R3-3 for the side effect this creates.

**INIT-R2-6 — fixed.** BOM'd manifest: exit 0, `outcome: "added"`, output still begins `ef bb bf` and the hook is present.

**INIT-R2-7 — fixed.** CRLF manifest: exit 0, `outcome: "added"`, every line ending in the rewritten file is `\r\n` including the trailing one (verified with `xxd`). Mixed-ending files are normalized to CRLF, which is an acceptable choice for an already-inconsistent file.

**INIT-R2-8 — partly fixed.** The status read is wrapped and returns `null` on throw, `{ orphans: false }` is passed, and both are asserted in the new `tests/agent-setup-tip.test.ts`. But the guard stops one line short: `resolvePrismaCliPackageCommand` at `agent-setup-tip.ts:38` still runs outside the `try`, and it does throw on an unreadable `package.json` — see INIT-R3-1.

**INIT-R2-9 — fixed.** No `setupPromptDismissedAt` remains anywhere in the tree (source, tests, docs, fixtures). `LocalStateStore.read` rebuilds the state from named keys only, so a state file written by an older CLI that still carries `agent: { … }` parses without error; the key is simply dropped the next time the file is written, which is correct now that nothing owns it.

**INIT-R2-10 — fixed.** `docs/product/output-conventions.md` now states the refusal rule, the `SKILLS.UNMANAGED_DIRECTORY` diagnostic, the `refused` array, the `unmanaged` State column value, the "does not count as out of date" rule, the exact non-over-claiming summary line, and the "directory without a `SKILL.md` is treated as absent" rule; it also restores a sentence saying the synced copies are ordinary git-tracked files. `command-principles.md` adds `skills` and `init` to the preview-scope list and the split between cwd's `package.json` and the workspace root. No new prose is hard-wrapped, and none of the banned words appears in any added line.

**INIT-R2-11 — fixed.** `skills-check.ts:46-50` passes the resolved `projectRoot` and `checkDisabled: false`, and `readSkillsStatus` honours both. `checkDisabled: false` is exactly what the second read would have produced, since the function has already returned when the flag is true, and `renderStaleNotice` never reads the field. Behavior unchanged; the duplicate ancestor walk and file read are gone.

#### New findings

**INIT-R3-1 — low — `packages/cli/src/commands/auth/agent-setup-tip.ts:38`**

The tip can still fail a login that succeeded. Only `readSkillsStatus` was wrapped; `resolvePrismaCliPackageCommand` runs after the `try/catch` and walks every ancestor directory reading each `package.json` with `readFileSync`, rethrowing anything that is not ENOENT (`lib/agent/package-manager.ts:89-96`, and `fileExists` at `:121-129` does the same for lockfiles). Reproduced directly: with a chmod-000 `package.json` in the cwd, `resolvePrismaCliPackageCommand` throws `EACCES`. It reaches `login.ts:148` after the credential is stored, which is the exact failure INIT-R2-8 described. Move the resolver call inside the same `try`, or return `null` when it throws.

**INIT-R3-2 — low — `packages/cli/src/lib/skills/status.ts:221-223`**

A `SKILL.md` that exists but cannot be read is now destroyed instead of refused. `stampState` maps `stamp === null` to `absent`, and `readSkillStamp` returns `null` for any read failure, not only for a missing file — so ENOENT, EACCES, and EISDIR are indistinguishable. Reproduced: a user-authored `.claude/skills/prisma-8/` with a chmod-000 `SKILL.md` and a sibling `notes.md` was reported as `synced` (not `refused`) and the whole directory was deleted and replaced with the packaged copy, `notes.md` included. Before the round-2 change this read as `unmanaged`. The fix that restores self-healing without reopening this: have the caller distinguish "no `SKILL.md` entry" from "`SKILL.md` present but unreadable" — stat the path, and treat only a genuinely absent entry as `absent`.

**INIT-R3-3 — nit — `packages/cli/src/lib/skills/sync.ts:62-69`**

The `.gitignore` cleanup is unconditional and permanent. Every `skills sync` issues one `rm` per already-current target forever, and it deletes any `.gitignore` in a managed copy, not just the `*` one an older CLI wrote — including one a user deliberately added to keep the copies out of git. That is a defensible position (the docs now say the copies are ordinary tracked files), but it is undocumented and unbounded. Either check the file's contents before removing it, or note the removal in `docs/product/output-conventions.md` alongside the sentence about git tracking.

#### Verdict

**ANOTHER ROUND NEEDED** — all eleven round-2 findings are addressed and the three that had to be fixed in this PR are verified fixed against the binary, but the round-2 fix for the unmanaged/absent split introduced a path where an unreadable user-authored `SKILL.md` is deleted (INIT-R3-2), and the login tip still has an unguarded throw one line past the new guard (INIT-R3-1); both are small, contained changes.

### Init slice — Round 4 (verification)

**Verification run locally:** `pnpm --filter @prisma/cli test` → 61 files, 914 passed / 1 skipped, exit 0 (up from 911, matching the three new tests). `pnpm --filter @prisma/cli typecheck` → clean. `pnpm lint` still aborts with `fatal runtime error: stack overflow` inside biome on every input in this worktree, unchanged from rounds 2 and 3, so lint conformance remains unverified. Everything below was exercised against the rebuilt binary (`packages/cli/dist/cli.js`) in throwaway fixture projects with a stub `@prisma/orm-postgres@8.1.0` shipping one skill, plus one direct call into `src/` through `tsx` for the login-tip case, not read off the diff. The three commits touch six files and nothing else; the worktree is clean.

#### Per-finding verdicts

**INIT-R3-1 — fixed.** `resolvePrismaCliPackageCommand` moved inside the same `try` as `readSkillsStatus` (`agent-setup-tip.ts:27-43`), and the now-unused `SkillsStatus` type import is gone. Reproduced the round-3 repro directly against `src/`: a project with a chmod-000 `package.json` and an installed source package. `readSkillsStatus` succeeded, `resolvePrismaCliPackageCommand` threw `EACCES`, and `resolveAgentSetupTipCommand` returned `null` with exit 0. The early returns kept their original conditions and order, so the only behavior change is that a resolver throw now yields no tip instead of failing the login. One side effect worth knowing rather than fixing: an `AbortError` from `ctx.signal` is now swallowed too, which means a cancelled login skips the tip instead of propagating — the right outcome for a tip, and `login.ts:148` does nothing else with it.

**INIT-R3-2 — fixed.** `stampState` became `targetState` and stats the `SKILL.md` path before deciding: `stamp === null` now means `absent` only when the file is genuinely missing, `unmanaged` otherwise (`status.ts:216-241`). Reproduced both sides against the binary. Unreadable file: a user-authored `.claude/skills/prisma-8/` with a chmod-000 `SKILL.md` and a sibling `notes.md` gave exit 0, `refused: [{"skill":"prisma-8","dirs":[".claude/skills"]}]`, `synced` covering only the other three harness dirs, the `SKILLS.UNMANAGED_DIRECTORY` diagnostic, `notes.md` intact, and `SKILL.md` byte-identical (md5 `f875c4bc…` before and after). Missing file: a partial tree holding only `references/usage.md` still classified `absent` and was fully rewritten — `synced` listed all four dirs, `refused` was empty, and the stale `usage.md` is gone. The `SkillTargetState` doc comment was updated to name the unreadable case.

**INIT-R3-3 — fixed.** The unconditional `rm` became `removeOldCliGitignore`, which reads the file and removes it only when the content matches `/^\*\r?\n?$/` (`sync.ts:112-125`); a read failure is a no-op. The regex covers exactly what the old CLI wrote — commit b154aef wrote the literal `"*\n"`. Reproduced: in an already-current project I planted `*\n`, bare `*`, and `*\r\n` in three managed copies; all three were removed, `synced`/`pruned`/`refused` all stayed empty, and `SKILL.md` kept the same md5, so nothing resynced. In a second project a user's `# keep these copies out of git\n*\n` and a `*.log` both survived verbatim. The docs sentence landed at `docs/product/output-conventions.md:119`. It sits in the existing unwrapped paragraph, and no banned word appears in any added line across the three commits.

#### New findings

**INIT-R4-1 — nit — `packages/cli/src/lib/skills/status.ts:238-240`**

A skill directory that cannot be listed at all still classifies as `absent`, and sync then fails the command with a raw internal error. With the whole `.claude/skills/prisma-8/` directory chmod-000, `stat` on the `SKILL.md` inside it fails, `pathExists` returns false, sync tries to replace the tree, and `rm(…, { recursive: true })` aborts with `CLI.INTERNAL_ERROR`, exit 1. No data is lost — the user's files survived because the OS refused the delete, not because the CLI declined. This is not a regression: at `b80ba18` the same directory also read as `absent` and hit the same `rm`. It is the same class of problem INIT-R3-2 named, one level up, and the cheap fix is the same shape — treat a `stat` failure that is not ENOENT as `unmanaged` rather than as absence.

**INIT-R4-2 — nit — `packages/cli/src/lib/skills/sync.ts:21-23`**

The `RefusedSkill` doc comment was left behind by the fix: it still reads "unstamped, or stamped by a package outside the allowlist", while the `SkillTargetState` comment in `status.ts` was updated to add "unreadable". The two comments describe the same set from opposite ends, so they should agree.

#### Verdict

**SATISFIED** — all three round-3 findings are verified fixed against the built binary, including the chmod-based cases, with the full test suite and typecheck green; the two remaining items are comment and edge-case nits, one of which predates this range.
