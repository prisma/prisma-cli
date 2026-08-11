# S3 dispatch plan — Composer adoption (revision 2)

Contract: `../specs/s3-composer.md` rev 2. Two repos. prisma-cli on
`s3-composer`; composer branch at D2. Implementers and reviewers on
Opus. Standing process rules as in the S2 plans.

Ordering and proofs: D1 merges and publishes an engine release
before D2 pins it. D2 proves published cross-repo consumption
(family skeleton + rebuilt CLI on the engine); D3 proves the
commands; D4 pins released versions in both directions. Release
order is always engine → composer → prisma-cli; previews via
composer's pkg.pr.new workflow mid-slice.

### D1 — `ctx.spawn` + credential injection (prisma-cli: engine)
Contract R-S3-1: the affordance (inherited stdio, same group,
record-and-replay signal latch, SIGTERM forwarding, abort ladder,
outlive-child, buffered commentary, reentrancy rule),
`Runtime.spawn` seam + harness fake, `exitWithChildStatus` +
session-kind settlement amendment, `--json` rejected as soon as
the command is known, credential injection with the SPI amendment
(the manager operation `activeAccessToken()` is the one unified
read for every credential origin — no source-based branch; an
environment-only manager implements it as a pass-through of the
env token; near-expiry refusal threshold ruled here), the
production environment-only CredentialManager exported from the
main entrypoint, draft amendments, the real-child/fake-spawn test split
from the contract's acceptance.

### D2 — composer foundations (prisma/composer)
Contract R-S3-2/3/5 minus the commands: exact-pinned engine
(dual-manifest, tsdown `external`, Dependabot ignore, tarball
check); the config projection + diagnostics-list loader rewrite +
`fix` → `nextActions` boundary translation; the alchemy-free
static-graph import check; the rebuilt thin CLI (engine + family
skeleton) replacing clipanion `main.ts`; both test surfaces (fake
child script; the control-API double + conformance check from
`./testing`); the S8 planner-drift read (alchemy source from installed
node_modules) reported as a note to the operator. (The
alchemy-patch item is dropped: types-only, no runtime effect.)
D2 and D3 land as a stack; the clipanion shell is deleted in D3.

### D3 — the four commands + e2e rewrite (prisma/composer)
Contract R-S3-4: deploy/destroy/dev/log as engine handlers
(config-evaluation listener strip; converges via `ctx.spawn`;
dev's live-session failure semantics; H8 stage + nextActions hint;
`--production` dropped). Composer's CLI e2e tests rewritten to
drive the exported commands (rebuilt CLI + `createTestCli`); the
clipanion shell, bespoke runner, and old e2e paths deleted.

### D4 — mount + release glue + closure (both repos)
Family mounted under `composer` in the prisma bin (node >= 24
floor); R-S3-6 release glue (ci.yml pin check, exact pins both
directions); divergence file; 1c closure with dispositions; ledger
Q2 + coverage-ledger corrections; slice review loop across both
PRs; PR descriptions per the ruled structure.

Completeness: D1 → the mechanism; D2 → cross-repo proof + test
infrastructure + the rebuilt CLI; D3 → the product surface proven
in composer's own CI; D4 → composition into `prisma`, release, and
record-keeping.
