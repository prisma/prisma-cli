# Markdown output format — dispatch plan

Slice contract: `specs/markdown-format.md`. One PR into `main` from this worktree's branch. Sequential dispatches, one persistent implementer. Each dispatch hands the next a state where the per-dispatch gate is green.

Per-dispatch gate: `pnpm --filter @prisma/cli-engine typecheck`, `pnpm --filter @prisma/cli-engine test`, `pnpm lint`. D4 adds the whole-repository gate from the spec's Done-when.

Commit discipline: bot identity per the global instructions (`git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, plus the Co-Authored-By line). One commit per dispatch is fine; the tip is what matters.

## D1 — `--format markdown` renders a completed run

**Outcome:** `--format markdown` is accepted, routes like human everywhere the engine branches on format, prints blocks and `### Next` and `### Diagnostics` as Markdown on stdout with stderr empty, colour off, width unbounded, the `stdout` thunk never called, and the `human` thunk called once. Every block-kind rule, the next-action bullet rules, the diagnostic shape (used here for diagnostics of a completed run), the blank-line rule, and the sensitive mask are implemented and pinned by tests.

**Builds on:** clean `origin/main` (e93d6e7). **Hands to D2:** a Markdown renderer module beside `rendering.ts` exposing the block, next-action, and diagnostic-shape renderers; `Format` widened; selection, colour, width, and materialisation plumbing done; the `=== "human"` sweep done in `engine.ts` and `settlement.ts`.

**Focus:** put the renderer in its own module (`execution/markdown.ts` or similar) and keep `rendering.ts` untouched apart from what routing needs. The sentence-case and placeholder helpers in `rendering.ts` are private; export or move them rather than duplicating. `plainText` in `palette.ts` already drops tones. Grep `packages/cli` tests for anything enumerating format values (`values: ["human", "json"]` appears in help output assertions) and update those assertions.

## D2 — Errors, version, child status, and live events

**Outcome:** an errored run prints the error shape then accompanying diagnostics on stdout under markdown, with the documented exit code and empty stderr; `--version` prints the bare version; a child-status settlement prints its next actions as bullets; live events follow the spec's event table (started and progress dropped, finished as `[outcome] step`, the rest as human, all on stdout). Each pinned by a test.

**Builds on:** D1's renderer module. **Hands to D3:** every non-help engine surface renders under markdown; tests green.

**Focus:** `emitErrored`, `settleVersion`, `settleChildStatus`, and `reportEvent`/`renderEventHuman` are the branch points. The stream for markdown is always `runtime.stdout`.

## D3 — Help in Markdown

**Outcome:** `help.ts` is a data model plus two renderers. Terminal help is byte-identical to today for root, group-with-workflow, and leaf cards (pin with fixtures rendered before the refactor). Markdown help follows the spec's shape exactly and goes to stdout. `--help` and bare-group invocations route to the Markdown renderer under `--format markdown`.

**Builds on:** D2 (help routing in `engine.ts` already treats markdown like human for the stream). **Hands to D4:** help complete; engine tests green.

**Focus:** capture today's terminal help output for the three fixture cards into test expectations first, then refactor. Existing help assertions live in `packages/cli/tests/bin.test.ts` and `tests/orm-mount.test.ts` (`toContain` checks) and in engine tests; they must still pass.

## D4 — Docs, engine version, whole-repository verification

**Outcome:** the three doc edits from the spec are made; `pnpm bump-cli-engine-version minor` has run; the whole-repository gate is green: `pnpm typecheck`, `pnpm lint`, `pnpm --filter @prisma/cli-engine test`, `pnpm --filter @prisma/cli test`, `pnpm --filter @repo/cli-conformance test`, `pnpm test:scripts`. A final grep shows no `=== "human"` or `!== "human"` left in the engine that would misroute markdown.

**Builds on:** D3. **Hands to:** slice DoD; PR-open.

**Focus:** do not touch `packages/cli` commands. The e2e suite needs credentials and may skip; report a skip plainly.

## Open items

- The PR will fail the `engine-pin-mismatch` conformance check until composer-cli and orm-toolchain republish on engine 0.4.0. Operator's release-chain call; record in the PR body.
