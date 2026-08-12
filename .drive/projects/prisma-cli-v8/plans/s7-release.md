# S7 dispatch plan — Release pipeline + rc1 (revision 1 — blocked on STOPs)

Contract: `../specs/s7-release.md` rev 1. One repo (prisma-cli), branch
`claude/s7-release-pipeline-rc1-92c89d`, base `main`. Implementers on
Opus, reviewers on Opus-4.8-mid. Standing process rules as in the S2/S3
plans: tests before implementation, no `vi.mock`/`vi.doMock`, pnpm only
(tarball smoke's sandbox npm install excepted, as ruled in S6), explicit
staging, bot identity with dual sign-off, push to the bot remote only.

**Nothing dispatches until the operator rules STOP-1 … STOP-8.** The
decomposition below is written against the contract's recommendations
and marks where a different ruling reshapes it.

Ordering: D1 → D2 are independent of the release machinery and can run
while STOP-5/7/8 settle; D3 → D4 → D5 are strictly ordered (the package
must exist before the automation covers it, the automation before the
pipeline verifies it); D6 closes. One PR for the slice.

### D1 — Mount the ORM family (packages/cli)

Tests first: extend `v8-mount-coverage.test.ts` (fails until the mount
lands — the 21 expected paths, `ormCommandFamily` in
`MOUNTED_FAMILIES`); a `v8-bin` semantic test running one ORM command
end to end through `createTestCli` (`migration list` against a fixture
project directory: envelope, presented rows, exit 0); a redirect test
(`migration apply` settles as the typed redirect, exit per engine); a
`--help` test naming the `contract`, `db`, `migration`, `ref` groups.
Then: the `@prisma/orm-toolchain` dependency at the STOP-7(ii) interim
exact version; `cli.ts` imports the family from
`@prisma/orm-toolchain/cli`, spreads its commands, adds the four group
briefs. Watch for: the family keys are full mount paths already — no
renaming layer; config-section and redirects ride the family object.
Divergence file `assets/s2/parity-divergences-s7.md` opened (expected
content: "none"; plus the deferred.md entry for the static-import cost).

### D2 — The completeness check fails the build (repo root + CI)

Tests first: a fixture-level test proving the check reports (a) a
family command absent from the tree, (b) a mounted command owned by no
family and not excepted — both via a constructed family/tree pair, not
by mutating the real mount. Then: `check:grammar` as a turbo task
(`dependsOn: ["^build"]`, `cache: false`) running the mount-coverage
suite file; wired into `pr-quality.yml` and `publish.yml` before the
first publish step under its `publish == 'true'` condition. The
exception list gets a doc comment naming STOP-4's ratification and the
rule that additions require an operator ruling.
Reshaped by: STOP-4 (if utilities move into the platform family, the
exception set shrinks to the telemetry trio).

### D3 — The `prisma` package (packages/prisma + packages/cli)

Blocked by: STOP-3. Written against (a):
Tests first: a packaging test asserting the built `dist/prisma.js`
exists, is executable-shaped (shebang), and `node dist/prisma.js
--version` in a bare env prints the lockstep version at exit 0 (run
against the built workspace, not a mock); `set-version-utils.test.ts`
extended for the new lockstep member.
Then: `packages/prisma` (name `prisma`, lockstep version, bin map,
`files: ["dist"]`, README, exact workspace pin on `@prisma/cli`);
`@prisma/cli` gains the `"./v8-bin"` export and declares the v8 entry
as a second bin (`prisma` → `dist/v8/cli.js`) so both names ship the
same tree; `scripts/set-version.ts` lockstep set + `bump-version`
updated; tsdown config for the facade.

### D4 — Committed versions + conformance wiring (manifests + CI)

Blocked by: STOP-5, STOP-7. Written against STOP-5(a) — S6 lands
first:
`packages/cli` pins `@prisma/composer` and `@prisma/orm-toolchain`
exact (already the style; versions per STOP-7); `pnpm conformance`
added to `publish.yml` before publish steps, its subject list extended
with the `prisma` tarball; the S6-3c interim exception entry (dated
triple) committed if the pins have not converged by then.
If STOP-5(b): D4 instead implements the inline smoke per the contract
(S6 3b mechanics, ~40 lines, written to S6's spec so absorption is a
move), and the 3c pin comparison is NOT built here — the pins' exactness
is still asserted by the existing manifest style plus D5's install
smoke resolving a single engine copy.

### D5 — The pipeline (publish.yml + scripts)

Blocked by: STOP-1, STOP-2, STOP-8. Written against 1(a)/2(a)/8:
Tests first where testable: the override-computation helper (workspace
package → packed tarball map, recursive) as a pure function with its
own unit tests in `scripts/`; `determine-version` untouched (nothing
dynamic added). Then, in `publish.yml`: pack stage (three tarballs via
`pnpm pack` — order matters, packing rebuilds dist per S6's finding
16, so the grammar check and conformance run before packing);
out-of-workspace install smoke (npm, `--ignore-scripts`, absolute
`file:` overrides, every declared bin from every packed manifest
started with `--version` under a timeout, exit 0 required); tarball
upload as workflow artifacts; Release assets attached in the existing
Release step; the guarded `prisma` publish step (STOP-8's
`publish-prisma` dispatch input, default false). Dry-run dispatch path
covers pack + smoke + upload, skipping registry writes and Release —
this is the verification surface for the whole slice (never a real
publish from this work; a real publish is the operator's action).

### D6 — Docs, records, close-out prep

`docs/oss/versioning.md` (the `prisma` package, the artifact stage, the
guarded publish); `rollout-plan.md` step 4 pointed at the pipeline;
`plan.md` §S7 updated; `deferred.md`: close the two-copy-install entry
when STOP-7 convergence lands, add the ORM import-weight entry; PR
description per the ruled structure (grounding example first,
alternatives last). Slice review loop (architect + principal-engineer
personas), findings folded, operator walkthrough.

Completeness: D1 → the tree; D2 → the check that guards it; D3 → the
package rc1 ships as; D4 → the pins and their verification; D5 → the
automated path from release commit to verified artifact; D6 → the
records. Together: the operator merges one bump PR and rc1's artifacts
exist, verified, published where the registry allows.
