# Handover brief — @prisma/orm-toolchain declares the engine as an exact peer

Written 2026-08-13 for an independent agent with NO prior context. The operator is Will Madden ("the operator"). Where this brief summarizes a document, the document wins. This is the prisma/prisma share of the strategy whose composer share is `composer-cli-split-handover.md` in this directory; the two can land independently.

## 1. Read first, in this order

1. **ADR 0004** in prisma-cli: `docs/architecture/adrs/0004-engine-version-pinning.md` (on `main`, or on the `claude/composer-cli-split-brief` branch if not yet merged). It is the normative strategy record: one engine per install, product CLI packages declare `@prisma/cli-engine` as an **exact peerDependency** the shell satisfies, product libraries carry no engine relationship, ranges are post-GA only.
2. This project directory in prisma-cli (`.drive/projects/prisma-cli-v8/`): `specs/s6-conformance.md` §1 and §5 for the defect class and the 2026-08-12 rulings.
3. In prisma/prisma (`/Users/wmadden/Projects/prisma/prisma`): the repo's agent guidance (CLAUDE.md / AGENTS.md), `docs/architecture docs/adrs/ADR 242 - Public npm surface...` (the shell/publish-surface model — note the directory name contains a literal space), and `scripts/check-conformance.mjs` (the conformance checks landed 2026-08-12 as PR #29998).
4. **Always `git fetch origin main` before reading any repo** — local checkouts on this machine are routinely stale, and that has produced wrong conclusions twice. Work in a fresh worktree off prisma/prisma `origin/main`.

## 2. The work

`@prisma/orm-toolchain` is already the ORM's dev/CLI package — applications never install it directly (they reach the vite plugin through `@prisma/orm-postgres/vite-plugin-contract-emit`, a forwarded export), so no package split is needed. The change is the dependency field:

- `@prisma/orm-toolchain`'s published manifest moves `@prisma/cli-engine` from `dependencies` to **`peerDependencies` with the same exact version**, keeping a `devDependency` at that version so the workspace and its tests resolve it.
- **The manifest is generated, not hand-edited.** ADR 242's shell-build derives the published packages' manifests from the internal packages they bundle (`packages/0-config/tsdown/shell-build.ts`, `@internal/publish-surface` at `packages/0-shared/publish-surface/`). There is precedent for hand-declared peers — the `handWrittenPeers` set in shell-build already carries `typescript`, and the packed manifest today shows `typescript` and `vite` as peers. Find the sanctioned route for declaring the engine as a peer of the toolchain shell (likely: the engine joins the hand-written peers for that shell, and `@internal/cli`'s own manifest keeps the engine as a devDependency). Do not fight the generator; if the generator cannot express this, that is a STOP, not an improvisation.
- `@internal/cli` (`packages/1-framework/3-tooling/cli/`) currently carries `"@prisma/cli-engine": "0.0.9"` in `dependencies`. Decide with the generator's rules where it belongs after the change (devDependencies is the expectation, since the published artifact no longer ships the engine as a dependency); `test/integration`'s own pin is private/dev usage and stays.

## 3. The checks follow the strategy (same repo, same PR)

`scripts/check-conformance.mjs` currently asserts the engine pin is exact and identical across the manifests that declare it in `dependencies`. Under ADR 0004 it becomes:

- The toolchain's packed manifest declares the engine in **`peerDependencies`, exact, and NOT in `dependencies`** — a `dependencies` entry reappearing is a finding.
- Every remaining engine reference in the repo (internal cli devDependency, integration tests) agrees with the peer's version.
- The packed-output import-purity check keeps treating a bare `@prisma/cli-engine` import in `cli.mjs` as satisfied — peers count as consumer-installed (they already do in that script's field set; verify, don't assume).
- `scripts/check-publish-deps.mjs` must still pass — read its rules before changing any manifest field; its `@internal/*` exact-pin logic must not start flagging the new arrangement.

Sandbox note for the tarball leg: with the engine as a peer, `npm install` (v7+) auto-installs it from the registry — but the exact peer version may be UNPUBLISHED at check time (that is the point of the tandem release). The conformance sandbox already supplies unpublished workspace siblings through computed version-qualified `file:` overrides; extend that mechanism to satisfy the engine peer from a packed/local source if needed, and prove the `prisma-next` bin still starts in the sandbox.

## 4. What you do NOT do

- No changes in prisma-cli or composer. The shell's side (peer-satisfaction check, exception-list deletion) is a separate follow-up there.
- No version-range peers. Exact only; ranges are a post-GA decision the operator has not made.
- No engine version changes. Whether the engine decouples from the shell's lockstep is marked OPEN in ADR 0004.

## 5. STOP — surface before implementing

- **STOP-1**: the generator route for the peer (handWrittenPeers vs something else), if shell-build's model resists it.
- **STOP-2**: if moving `@internal/cli`'s engine dep to devDependencies breaks how shell-build computes the toolchain's dependency set, surface the options rather than picking one.
- Anything that would change `@prisma/orm-toolchain`'s export map or bin — out of scope, surface it.

## 6. Process rules (operator-enforced, non-negotiable)

- Git identity: the `wmadden-electric` bot. Commit `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`; end commit bodies with a `Co-Authored-By:` line naming your model. Push ONLY to `git@github-wmadden-electric:prisma/prisma.git`. Never force-push. Stage by path.
- pnpm only, never npm/npx — except inside the conformance sandbox, which is deliberately npm.
- Tests first; the repo's io-seam style (`scripts/check-conformance.test.mjs` is the model); no module mocking. New/changed script tests must be in the root `test:scripts` list or they never run.
- NEVER hard-wrap markdown prose. Plain-English reports; banned words: "load-bearing", "smoking gun", "belt and suspenders", "gate".
- One DRAFT PR, base `main`. Description: grounding example first (a real install/resolution before/after), then the decision (cite ADR 0004), then the narrative, alternatives last. Reference prisma/prisma#29998 and prisma-cli#161 as the sibling conformance work.
- Verification, each as the command's own exit code: `pnpm test:scripts`, `node --test scripts/check-conformance.test.mjs`, `pnpm check:conformance` end to end (must exit 0), `pnpm check:publish-deps`, and the touched packages' suites.

## 7. Your first report

Confirm you read ADR 0004 and this brief; state STOP answers you need; list any §2/§3 fact that no longer holds on origin/main (re-verify, do not trust this snapshot); then your plan.
