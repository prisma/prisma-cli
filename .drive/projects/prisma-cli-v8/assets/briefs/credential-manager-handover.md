# Credential-manager rework handover — finish remediation, close out PR #130

Written 2026-08-10 for an agent with NO context on this session.
The operator is Will Madden. Everything you need is in this file or
the named documents; where this brief summarizes a document, the
document wins.

## 1. Where you are

Repo `prisma/prisma-cli`, worktree checked out from branch
`claude/prisma-cli-s1-d6-013cea`, working branch `s2a-foundations`
(= PR #130, open, base `main`). This branch
carries slice S2a of the v8 CLI port PLUS a full rework of the auth
family onto a new component, the **credential manager**. The rework
is functionally complete and reviewed; what remains is exactly:

1. FINISH the remediation of the verification findings (§4 below) —
   an implementer was halted mid-work by a rate limit; its partial,
   **unverified** state is committed as `4b006d1`.
2. Re-run verification (§5).
3. Rewrite #130's PR description (§6) and hand the PR to Will.

No background agents are running. Two INDEPENDENT agents (not
yours) work slices S2b and S2c in other worktrees; they merge this
branch down. Do not touch their branches (`s2b-resources`,
`s2c-services`).

## 2. The design you are implementing against

`.drive/projects/prisma-cli-v8/assets/engine/credential-manager-design.md`
— revision 5, NORMATIVE, at HEAD. Read it in full before any code
change. One-paragraph summary: the CLI holds per-workspace
**sessions** (a session = "logged in to workspace X"; at most one
per workspace, keyed by workspace id, one current). A process PINS
its session at first read for its whole lifetime. The engine
(`packages/cli-engine`) owns the management API client; the manager
(`packages/cli/src/auth/credential-manager.ts`, class
`FileCredentialManager`) owns the state file (same path as the
legacy auth file, new shape, atomic 0600 writes, one short advisory
lock, no network under the lock) and implements the platform SDK's
`TokenStorage` so 401→refresh→retry writes land under its rules.
Racing refreshes are deliberately uncoordinated across processes —
the auth server absorbs them (10s refresh-token reuse grace;
sibling pairs stay valid). Identity is NOT tracked (wallet is
identity-blind, operator ruling). Six v8 commands sit on top with
their LEGACY names: `auth login|logout|whoami`,
`auth workspace list|use|logout`. `workspace use` SELECTS among
held sessions only — it never opens a browser (operator ruling).

Engine affordances added this session (already landed): consent
tokens + global repeatable `--confirm <value>` flag (type-to-confirm
interactive; exact-match non-interactive; `--yes` still cannot grant
consent), `ctx.openUrl` (degrades to printing the URL), and
`prompt.browserWait` (non-interactive → structured
interaction-required error, exit 2). `needs.interaction` predates
them and is the declarative interactivity requirement.

## 3. Commit map (this session's work, all pushed)

- `a8ef3fb` engine surface (rev-4 shape, superseded)
- `9384a95` engine reworked to rev 5 (session model)
- `6bb8452` consent tokens / `--confirm` / openUrl / browserWait
- `9ffbb01` the real manager: persistence, pinning, migration,
  `performLogin` custody split, bin wiring
- `ddbb816` six v8 auth commands + parity/contract doc rewrites
- `d7e8df9`, `7716e8b`, and earlier `015ae55`/`e24d1d5` — design-doc
  revisions and rulings
- `4b006d1` **PARTIAL, UNVERIFIED** remediation (see §4)

At `7716e8b` (pre-remediation) every suite was green: cli 814,
cli-engine 234, telemetry 97, typecheck, root lint all exit 0.

## 4. YOUR FIRST TASK — finish the remediation

The verification review (full findings below) reported 1 blocker,
6 should-fix, 8 notes. The halted implementer had addressed most of
them; commit `4b006d1` contains its uncommitted tree at halt time —
its last status: "Now the worker stderr capture (finding 14) and
server teardown." NOTHING in `4b006d1` has been test-run.

Procedure:
1. `git show 4b006d1` and map each hunk to a finding number.
2. Complete what is missing (at minimum finding 14's worker-stderr
   leak capture and whatever "server teardown" it was mid-way
   through — check `packages/cli/tests/credential-manager-processes.test.ts`
   and `tests/helpers/credential-manager-worker.ts` for a scripted
   token-endpoint HTTP server that may leak between tests).
3. Run ALL suites (§7 verification commands). Fix what fails.
4. Amend or follow-up commit (`fix(cli): credential-manager
   verification findings`, body listing finding numbers; commit
   rules §7).

The findings (severity, file:line refs are pre-remediation at
`7716e8b`; verify against current state):

- **1 BLOCKER** `packages/cli-engine/src/execution/api-client.ts:161-164`:
  a non-`AuthError` from the refresh path must map to the transient
  auth-service error (`CLI.AUTH_SERVICE_ERROR`), NOT escape as the
  raw cause (`CLI.INTERNAL_ERROR`, exit 1). Spec §6. CLI structured
  errors must still pass through unwrapped (existing test
  `packages/cli-engine/tests/management-api.test.ts:391`). Needs
  tests. `4b006d1` touches this file — verify the fix + tests exist.
- **2** Engine-side `PRISMA_NEXT_DEBUG` valve for the refresh
  mapping (spec §6: refresh attempted, endpoint status + error
  field). `4b006d1` adds `packages/cli-engine/src/execution/debug.ts`
  — verify wiring, on/off tests, and that the leak scan covers it.
- **3** `packages/cli/src/v8/auth/whoami.ts`: env-session identity
  from decoding the env token FIRST (no network for it); `/v1/me`
  is the stored-session path only (spec §6a as amended).
- **4** Env-override test matrix completeness (spec §5): every
  mutation × {unset, set, blank, whitespace}; `createSession` under
  blank/whitespace; state-file byte-equality.
- **5** Assert the §8 atomic-write mechanism (temp + fsync + rename;
  no `.tmp` sibling remains; sync-before-rename ordering). Do not
  weaken `packages/cli/src/auth/state-file.ts:167-190` to test it.
- **6** Assert §8 rotation durability: rotated pair persisted before
  the new access token reaches any caller.
- **7** `credential-manager-processes.test.ts`: the two-process
  rotation test must drive a REAL refresh through a scripted local
  token endpoint (mimic the 10s reuse grace), not direct
  `setTokens` calls. `4b006d1` touches these files — verify.
- **9** Blank/whitespace `PRISMA_SERVICE_TOKEN` must not read as "in
  force" in `workspace-list.ts` / `login.ts` (`!== undefined` was
  the bug); blank → the single `AUTH.SERVICE_TOKEN_EMPTY` outcome.
  `4b006d1` adds `packages/cli/src/auth/service-token.ts` — verify
  both commands use it, with tests.
- **10** `endAllSessions` env-override no-op (zero stored sessions)
  must still unlink the legacy context sidecar (spec §7).
- **11** Reads-never-write probe also spies unlink/rm + sync fs
  write APIs.
- **12** `api-client.ts:96-98` blank-token fallback must use the
  single-sourced `emptyServiceTokenError` (currently duplicated
  logic; unreachable but wrong).
- **14** Leak-scan coverage: rotation/clear debug lines, every
  refresh-failure error path, worker-process stderr.
- **SKIP by ruling**: finding 8 (whoami override notice
  unconditional — the doc at HEAD §6 was amended to say exactly
  that; the reviewer's citation was stale), findings 13 and 15
  (verified fine / unreachable by construction).

## 5. Then: re-verification

Dispatch a fresh reviewer subagent (model: Opus, read-only) to
re-verify ONLY the findings above against the code on disk plus a
smoke pass over spec §§3–8 conformance (the previous full
verification found everything else SATISFIED — do not re-litigate
what it passed). Fix anything it raises; loop until clean.

## 6. Then: PR #130 description + handoff

Rewrite #130's description (gh CLI; the PR is on
prisma/prisma-cli). Will's ruled structure, in order: a GROUNDING
EXAMPLE first (a real command run, before/after), then the
decision, then the narrative, alternatives last. No internal
process codes, no dispatch/round labels, no reviewer numbering.
Content must cover BOTH the original S2a scope (engine
production-readiness: ctx.api, prompts via clack, telemetry,
versioning/publish machinery, version command) AND the auth rework
(the session model — summarize §2 of this brief; name the
user-visible changes: `logout --workspace` gone, `--confirm <token>`
for scripted consent, exit-code unifications, whoami shape). The
parity story lives in
`.drive/projects/prisma-cli-v8/assets/s2/parity-divergences.md`
(auth sections just rewritten — link, don't duplicate). Then tell
Will it is ready for his re-review. Do NOT merge; do NOT mark
ready-for-review yourself unless the draft state blocks his review.

## 7. Process rules (non-negotiable, operator-enforced)

- Git identity — you are the `wmadden-electric` bot: stage
  explicitly by path (NEVER `git add -A`/`-u`; NEVER anything under
  `wip/` or `.drive/projects/prisma-cli-v8/specs/reviews/`); commit
  `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`
  with body ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`;
  push ONLY to `git@github-wmadden-electric:prisma/prisma-cli.git`
  (remote `bot`).
- Verification per change: `pnpm --filter @prisma/cli test`,
  `pnpm --filter @prisma/cli-engine test`,
  `pnpm --filter @repo/cli-telemetry test`, `pnpm typecheck`, and
  root lint measured as pnpm's OWN exit code with `wip/` moved
  aside in one shell:
  `mv wip /tmp/wip-stash && pnpm lint; s=$?; mv /tmp/wip-stash wip`.
- `wip/repos/` holds read-only reference clones (pdp-control-plane,
  prisma, composer) — never stage, never modify. The platform
  SDK source referenced by the design is
  `wip/repos/pdp-control-plane/packages/management-api-sdk/src/`.
- Subagents: implementers AND reviewers on Opus (operator ruling,
  rate limits).
- Reports to Will: plain English, full sentences, no invented
  shorthand, no session-internal labels. Banned words:
  "load-bearing", "smoking gun", "belt and suspenders", "gate".
  Report only outcomes, decisions he must make, and changes to his
  world — fold self-corrected slips silently. Bring questions to
  decide, not decisions to ratify. STOP on any design-vs-code
  contradiction the design does not anticipate; never improvise.
  Do not use the question UI.
- Legacy exports in `packages/cli/src/auth` (listAuthWorkspaces,
  switchAuthWorkspace, logoutAuthWorkspace, FileTokenStorage) must
  keep working until slice S2d.
- Never commit while another agent has staged changes in this
  worktree; when committing docs beside in-flight code, use
  path-scoped commits (`git commit --only <path>`).

## 8. Wider state (context, not tasks)

- Publishing: `@prisma/cli-engine@0.0.1` is on npm (operator's
  manual initial publish); OIDC trusted publishing is configured;
  the repo's publish machinery is prisma/prisma's verbatim at
  lockstep `8.0.0-rc.1` (root package.json; engine's package.json
  must stay at 8.0.0-rc.1). Merged `chore(release)` bump PRs
  publish to `latest`; ordinary main pushes publish `-dev.N`.
- S2b (resources) and S2c (services) run with independent agents in
  `.claude/worktrees/s2b-resources` and their own worktree; briefs
  at `.drive/projects/prisma-cli-v8/assets/briefs/
  {s2b-handover,s2c-handover}.md`. Standing relays already sent to
  them: no TTY reads in commands (`needs.interaction` +
  browserWait), no hand-rolled consent flags (`--confirm <token>`
  is engine-owned), `git connect` ports against browserWait.
- Operator question ledger + standing S2 rulings:
  `.drive/projects/prisma-cli-v8/specs/s2-overview.md`.
- The normative engine interface commentary:
  `.drive/projects/prisma-cli-v8/assets/engine/engine-interface-draft.ts`
  (amended to rev 5 this session).

Your first report to Will: confirm you read the design doc and this
brief, state the disposition of `4b006d1` per finding, and give
your plan for §4 step 2. Then execute.
