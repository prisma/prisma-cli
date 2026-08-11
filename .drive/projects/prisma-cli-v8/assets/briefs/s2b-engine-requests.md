# Engine changes S2b needs — brief for the operator

Written 2026-08-10 by the s2b-resources orchestrator. Two changes to `packages/cli-engine`, both small and additive. S2b may not touch the engine, so these are for the operator to land on `s2a-foundations`, which is this slice's base and merge target.

Everything else in S2b is finished and green. These two are the only thing blocking `git connect` step 5 — the wait for a GitHub App installation — and with it the slice's closure review and pull request.

## Why these are needed at all

`d3-bucket-branch-git.md` §3.8 was written before the engine had a browser-wait helper. The helper that landed, `ctx.prompt.browserWait`, is narrower than the design assumed, so three pinned facts had nowhere to go. One turned out to be a design error, one is fixed by change 1 below, and one is being dropped deliberately (see "Not requested"). Change 2 is a separate defect the port surfaced.

## Change 1 — `browserWait` should accept a poll interval

**Problem.** Legacy `git connect` reads `PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS` (default 2000ms) and polls on it. `BrowserWaitRequest` has no interval field, and the engine polls on a private module constant fixed at 1000ms, so the environment variable has nowhere to go. The companion `PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS` maps cleanly onto the existing `timeout`; only the interval is affected.

**Change.** Add an optional interval to the request and honour it.

- `packages/cli-engine/src/context.ts:116` — `BrowserWaitRequest` gains:

  ```ts
  /** How often to call poll. Defaults to the engine's own interval. */
  readonly interval?: number;
  ```

- `packages/cli-engine/src/execution/prompts.ts:431` — the delay call uses `interval ?? BROWSER_WAIT_POLL_INTERVAL_MS` instead of the bare constant. The constant stays as the default; nothing else moves.

**Compatibility.** Additive and optional, so every existing caller keeps the 1000ms behaviour.

**Test.** `packages/cli-engine/tests/interaction-affordances.test.ts:292` already has a `prompt.browserWait` block. One case there: a request with an explicit interval polls on that interval rather than the default. Note the test harness stubs `delay` to a no-op (`src/testing.ts:161`), so assert the value passed to `delay`, not elapsed wall-clock time.

**What S2b does with it.** `git connect` reads both environment variables from `ctx.env` with the legacy positive-integer parsing and passes them as `interval` and `timeout`. This also makes the design's own pinned test case writable as specified — it asks for the interval set to 1ms to prove the poll loop.

## Change 2 — `NextAction` needs a kind that means "open this URL"

**Problem.** This is a correctness defect in the agent-facing envelope, not a parity question. The legacy errors `REPO_INSTALLATION_REQUIRED` and `REPO_NOT_ACCESSIBLE` carry the raw GitHub App install URL in their `nextSteps` (`controllers/project.ts:2208` and `:2229`). Conventions §4 turns every `nextSteps` string into a `run-command` action. The result is an action instructing the consumer to execute `https://github.com/apps/...` as a shell command, which fails if anything takes it literally. None of the four existing kinds — `run-command`, `user-choice`, `edit-file`, `done` — means "open this URL", so the information cannot currently be expressed.

**Change.** Add the kind and a field to carry the URL.

- `packages/cli-engine/src/protocol.ts:28` — add `"open-url"` to the kind union.
- `packages/cli-engine/src/protocol.ts` — `NextAction` gains `readonly url?: string`, alongside the existing `command`.
- `packages/cli-engine/src/execution/rendering.ts:150` — `renderNextAction` currently appends `: ${action.command}` when a command is present. Make it fall back to `action.url`, so an `open-url` action renders its URL rather than just its label.

**Blast radius: none beyond those three edits.** I checked every engine consumer of `nextActions`. Nothing switches on `kind`: `settlement.ts` passes the array straight into the envelope, and `renderNextAction` is the only renderer. The json envelope carries actions through untouched, so the new kind reaches machine consumers for free.

**Test.** `packages/cli-engine/tests/protocol.test.ts` for the envelope shape, and one rendering case proving an `open-url` action prints its URL.

**What S2b does with it.** The git mapper stops sending URLs through the `run-command` path and emits `{ kind: "open-url", label, url }`. Separately, the postgres plan-limit error currently smuggles its upgrade URL into a `user-choice` reason; that can move onto the new kind whenever you want the consistency, but it is not part of this request and I would not change it inside this slice.

## Not requested, deliberately

**`browserWait` returning whether the browser opened.** I raised this and then withdrew it; recording the reasoning so nobody re-opens it.

Legacy branched on an `opened` boolean in two places: which of two wait sentences it printed, and which fix text `REPO_INSTALLATION_REQUIRED` carried. `announceUrl` still computes the value and `browserWait` discards it, so exposing it would be about as small as change 1.

It is not worth it. Both legacy branches existed to solve one problem — making sure the user has the install URL when no browser opened, which is why legacy printed the raw URL on its own line only in the not-opened branch. That problem cannot occur in v8: `rendering.ts:50` writes the endpoint event's URL to stderr unconditionally, and json mode receives it as a frame, so the URL is always present regardless of what the browser did. What remains is tone. On top of that the signal is weak — the runtime's opener is `open(url)` from the npm `open` package, so a true result means the OS accepted the handoff, not that a browser window appeared.

S2b therefore takes the browser-opened wording and fix text, drops `meta.opened`, and records the divergence. Operator ruling, 2026-08-10.

**Progress events during the wait.** §3.8 pinned a three-event sequence — the URL, then "waiting", then "connected". No engine change is needed, because the design was wrong: legacy prints one wait line before the poll loop and nothing during it (fact sheet §6, "no status re-print during polling"), and there is no "connected" line either. The engine's single `endpoint` event is exactly the legacy shape. The pinned sequence is struck from the design as an error rather than recorded as a loss.

## After they land

1. You push both to `s2a-foundations`.
2. I rebase `s2b-resources-work` onto the new tip and re-run the full check.
3. I pin the four outcomes in `d3-bucket-branch-git.md` §3.8 — interval restored, single announcement event, `opened` dropped, `open-url` for the install URL.
4. The implementer writes step 5 and the four wait-path test cases the design enumerates: installation-required, not-accessible, poll-then-found, and poll timeout.
5. Review round on step 5, then the closure dispatch — divergence consolidation, the architect and principal-engineer review loop, and the pull request onto `s2a-foundations`.
