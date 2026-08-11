# PR #130 — code review (principal-engineer pass)

**Review range:** `origin/main...HEAD` on branch `s2a-foundations` (pull request 130). 184 files, 18,868 added lines, 2,105 removed.

**Expectation sources, in priority order:**

1. `.drive/projects/prisma-cli-v8/specs/s2a-foundations.md` — the slice contract, including its two 2026-08-10 errata and its Acceptance list.
2. `.drive/projects/prisma-cli-v8/assets/engine/credential-manager-design.md` — revision 5, normative for the credential manager. Sections 5 to 8 are treated as acceptance criteria alongside the contract.
3. `.drive/projects/prisma-cli-v8/assets/s2/parity-divergences.md` — the recorded behaviour differences from the shipping CLI.
4. The pull request description (`gh pr view 130`).
5. Repo conventions: `AGENTS.md`, `packages/cli-engine/README.md`.

**Verification run at HEAD (47e53c0):** `pnpm --filter @prisma/cli test`, `pnpm --filter @prisma/cli-engine test`, `pnpm --filter @repo/cli-telemetry test`, `pnpm typecheck`, and `pnpm lint` all exit 0.

**Out of scope for this pass:** naming, typology, system shape, bounded contexts and vocabulary (the architect pass covers these, running in parallel); adopter learnability; scope and user value; open-source surface stewardship.

## Summary

The credential manager is careful, well-tested work that mostly does what the design says, and the test suite proves behaviour rather than structure. The defects worth fixing are concentrated in the advisory lock in `state-file.ts` — two processes can take over the same stale lock at the same time, and one failure mode is an unbounded busy loop with no timeout — plus a handful of error-path gaps where a failed write, a hung name lookup, or a session cleared mid-`whoami` leaves the user with the wrong answer.

## What looks solid

The test suite is the strongest part of this change and it is worth saying so plainly. It asserts observable behaviour, not structure: the two-process refresh test drives two real SDK refreshes through a scripted token endpoint that reproduces the server's ten-second reuse grace and then checks the file holds one of the two issued pairs; the reads-never-write probe spies eleven filesystem entry points and carries a positive control so a probe that cannot see writes at all would fail; the atomicity test asserts the exact `open tmp` → `sync` → `rename` ordering rather than just the end state; the engine's API-client tests assert the actual `Authorization` header on the wire, including that the environment path never touches the token endpoint on a 401. The leak scan seeds known secrets and checks stdout, stderr, debug lines, error own-properties and a worker process's stderr. These are tests that fail when the behaviour regresses.

Three design decisions in the code earn their keep. The failure mapping in `packages/cli-engine/src/execution/api-client.ts` discriminates by state (re-reading the bound workspace) rather than by parsing SDK messages, and the cause-chain walk has a visited set and a depth cap so a cyclic chain terminates. The debug valve deliberately logs only an error's type or the OAuth error field, never the auth service's free-text description — that restraint is correct and unusual. And `createSession` releasing the lock before the workspace-name lookup, then taking a second minimal lock that writes the name only if the record still exists, is exactly the shape the design asks for and the tests pin both halves of it.

The engine's `Proxy`-based lazy `ctx.api` construction is a genuinely cheap solution to "do not load or construct the SDK for runs that never call it", and the test that asserts nothing is constructed for a run that never issues a request holds it down.

## Findings

### F01 — Failed or crashed writes leave temp files holding live token material, and nothing ever removes them

**Location:** `packages/cli/src/auth/state-file.ts`, lines 169–190.

The write path creates `${filePath}.${randomUUID()}.tmp`, writes the full state into it (access tokens and refresh tokens), fsyncs, then renames. The `try/finally` around the write closes the handle but does not unlink the temp file, so any throw from `handle.writeFile` (ENOSPC, EIO) or from `handle.sync` leaves a complete copy of the credential state on disk under a name nothing knows about. The same is true if the process is killed between create and rename. Only the rename-failure path unlinks.

Those files are mode 0600, so this is not an exposure to other users, but it matters for two reasons: they accumulate without bound in the user's config directory, and `prisma auth logout` does not remove them. A user who runs `auth logout` to revoke local access can be left with working refresh tokens on disk. The random UUID in the name means each failure adds a new file rather than overwriting the last.

**Suggestion:** unlink the temp file whenever the write does not reach a successful rename, and reap leftovers in `endAllSessions`.

```ts
const handle = await fs.open(tempPath, "wx", FILE_MODE);
try {
  await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
  await handle.sync();
} catch (error) {
  await handle.close().catch(() => {});
  await fs.unlink(tempPath).catch(() => {});
  throw error;
} finally {
  await handle.close().catch(() => {});
}
```

In `endAllSessions`, after clearing the state, remove any sibling `<basename>.*.tmp` entries in the state directory as well as the legacy context sidecar.

### F02 — Two processes can take over the same stale lock at once, so both enter the critical section

**Location:** `packages/cli/src/auth/state-file.ts`, lines 241–250 and 272–283.

`takeOverStaleStateLock` stats the lock, decides it is stale, and unconditionally unlinks it. There is nothing to stop two waiting processes from both observing the same stale lock and both unlinking. The interleaving is: A stats (stale), B stats (stale), A unlinks the stale file, A creates its own lock and returns, B unlinks — removing **A's fresh lock** — and B then creates its own and returns. Both processes now believe they hold the lock and both run their read-modify-write concurrently. Because every mutation writes the whole state, one of the two mutations is silently lost.

The retry interval is 10ms, so two processes waiting on a crashed holder will very likely land in the same window. This is precisely the lost update the lock exists to prevent, in the one scenario (a crashed holder) the takeover path exists for. The existing test at `packages/cli/tests/credential-manager-processes.test.ts` lines 245–271 has a single taker, so it does not reach this.

**Suggestion:** make the takeover atomic by renaming rather than unlinking. Only one process can rename a given source path; the loser gets `ENOENT` and must not proceed.

```ts
async function takeOverStaleStateLock(lockPath: string, debug: DebugLog): Promise<boolean> {
  const stats = await fs.stat(lockPath).catch(() => null);
  if (!stats) return true;
  if (Date.now() - stats.mtimeMs <= LOCK_STALE_MS) return false;

  try {
    await fs.rename(lockPath, `${lockPath}.${randomUUID()}.stale`);
  } catch {
    return false; // another process took it over, or it went away — go round again
  }
  debug(`lock taken over from a crashed holder ${lockPath}`);
  return true;
}
```

The renamed file then needs reaping (same place as F01's temp files). Add a test that starts two takeovers against one stale lock and asserts both mutations land.

### F03 — A takeover that cannot delete the lock spins forever with no timeout

**Location:** `packages/cli/src/auth/state-file.ts`, lines 241–250 and 280–282.

`await fs.unlink(lockPath).catch(() => {})` swallows every failure and the function still returns `true`, which makes the acquisition loop `continue`. That `continue` skips both the `LOCK_WAIT_TIMEOUT_MS` check and the 10ms sleep. If the unlink can never succeed while the lock file remains stale, the loop runs flat out forever: no timeout, no sleep, one CPU core pinned, and the command never returns.

I confirmed the trigger empirically on darwin: with a stale lock file inside a directory the process cannot write to, `fs.open(lockPath, "wx")` returns `EEXIST` (so `tryCreateStateLock` returns false), `fs.stat` succeeds and reports the lock as 60 seconds old, and `fs.unlink` fails with `EACCES`. Every condition for the infinite loop holds. A read-only or root-owned config directory containing a leftover lock file is the realistic way in.

**Suggestion:** only treat a takeover as successful when the removal actually happened, and never skip the timeout check.

```ts
while (true) {
  if (await tryCreateStateLock(lockPath, lockId)) return lockId;
  const tookOver = await takeOverStaleStateLock(lockPath, debug);
  if (Date.now() - startedAt >= LOCK_WAIT_TIMEOUT_MS) {
    throw new StateLockTimeoutError(lockPath);
  }
  if (!tookOver) await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
}
```

With the F02 rename fix, a failed rename already returns `false`, which makes this correct; keeping the timeout check unconditional is what stops any future variant of the same bug.

### F04 — `whoami` reports "signed in" immediately after the refresh path deleted the session

**Location:** `packages/cli/src/v8/auth/whoami.ts`, lines 53–72 and 118–134.

`enrichedIdentity` wraps the `/v1/me` call in `catch { return null }`. That is right for a network failure — the design says whoami works offline. But the same catch swallows `CLI.CREDENTIALS_REQUIRED`, which is what the engine's mapping raises when the SDK's refresh returned `invalid_grant` and compare-and-clear removed the record. In that case the sequence is: `ctx.session()` reads a session that exists, the `/v1/me` request refreshes, the refresh fails as `invalid_grant`, the manager deletes the session from the file, whoami swallows the error, and the command prints `status: signed in` with `authenticated: true` and exits 0 — describing a session that no longer exists on disk. The next command the user runs will tell them to sign in.

This is the case where being told the truth matters most: an expired session is exactly what someone runs `whoami` to diagnose. No test covers it — `packages/cli/tests/v8-whoami.test.ts` only exercises an offline API that throws a plain `Error`.

**Suggestion:** let structured credential errors through and re-read the session before presenting.

```ts
} catch (cause) {
  signal.throwIfAborted();
  if (CliStructuredError.is(cause) && cause.code === "CLI.CREDENTIALS_REQUIRED") {
    throw cause;
  }
  return null;
}
```

Add a test that scripts a 401 plus an `invalid_grant` token response and asserts `whoami` does not report `authenticated: true`.

### F05 — The post-login workspace-name lookup has no timeout and no abort signal, so `auth login` can hang after the credential is stored

**Location:** `packages/cli/src/auth/workspace-name.ts`, lines 7–21; `packages/cli/src/auth/credential-manager.ts`, lines 174–176 and 374–385; `packages/cli/src/v8/runtime.ts`, lines 96–99.

`fetchWorkspaceName` builds a static-token client and calls `GET /v1/workspaces/{id}` with no `signal` and no timeout. `createSession` awaits it at line 175 and only handles a *throw* — a request that never settles is not a failure, it is a hang. The design's rule is that the name fetch is best-effort and "never fails login"; a hang is worse than a failure, because the credential has already been written and the user sees `auth login` sit there with no output after the browser round trip succeeded. Ctrl-C is not wired either: the manager is constructed in `assembleRuntime` with no access to the run's abort signal, so the engine's cancellation cannot reach the request.

**Suggestion:** give the lookup its own deadline, and pass the run's signal through when one is available.

```ts
export function fetchWorkspaceName(apiBaseUrl: string, timeoutMs = 5_000): FetchWorkspaceName {
  return async (credential, workspaceId) => {
    const { data } = await createManagementApiClient({ baseUrl: apiBaseUrl, token: credential.token })
      .GET("/v1/workspaces/{id}", {
        params: { path: { id: workspaceId } },
        signal: AbortSignal.timeout(timeoutMs),
      });
    ...
  };
}
```

A test that makes the lookup hang and asserts `createSession` still resolves would hold this down; the existing "holds no lock while the workspace name is fetched" test already has the hanging-fetch fixture to build on.

### F06 — The state file's `version` field is read but never checked, so a newer format is silently downgraded

**Location:** `packages/cli/src/auth/state-file.ts`, lines 118–165.

`readCredentialState` reads `shape.version` purely to echo it back, then filters the session list through `isStoredSession` and rewrites each entry through `normalizeSession`, which keeps exactly five known fields. Two consequences follow, and both are silent and destructive at the next mutation, because every mutation writes the whole state:

- A state file written by a future CLI at `version: 2` is read as if it were version 1. Any field version 2 added is dropped on the next `auth login` or token rotation. The version field exists precisely so this cannot happen, and nothing uses it.
- A session entry that fails `isStoredSession` (say, a record whose `token` was truncated by an interrupted third-party edit) is dropped from the in-memory state with no diagnostic, and the next mutation persists the deletion.

The blast radius here is the same one the design accepts for the legacy format — the file is at a shared path and the first write in a new shape is one-way — but the design's reasoning was "loud, `prisma auth login`-fixable". Downgrading a future format silently is neither loud nor obviously fixable.

**Suggestion:** refuse to write when the stored `version` is greater than `STATE_VERSION`, with a structured error naming the file and telling the user to upgrade the CLI; and debug-log when a session entry is dropped for being malformed.

### F07 — Write failures escape as raw Node errors while read failures get a structured one

**Location:** `packages/cli/src/auth/state-file.ts`, lines 169–190; compare lines 73–91 and 98–107.

The read path maps any non-`ENOENT` failure to `CLI.CREDENTIALS_UNREADABLE`, with the file path and an actionable next step. The write path has no counterpart. `fs.mkdir`, `fs.open`, `handle.writeFile`, `handle.sync` and `fs.rename` all throw their raw `ErrnoException` straight out of `#mutate` and out of the command. A user on a read-only home directory, with a full disk, or with the state path occupied by a directory sees `EROFS: read-only file system, mkdir '/…'` or `EISDIR` rather than a message that names what has to change. Because it is not a `CliStructuredError`, the engine settles it as an internal error rather than a could-not-complete.

This is not hypothetical for a CLI that runs in containers and CI images with read-only or ephemeral home directories.

**Suggestion:** wrap `writeCredentialState`'s body the way the read path is wrapped, with a `CLI.CREDENTIALS_UNWRITABLE` error carrying the resolved path, the errno, and a next action naming the directory whose permissions or free space must change.

### F08 — `PRISMA_AUTH_FILE` is honoured by the new manager but ignored by the legacy reader that shares the file

**Location:** `packages/cli/src/auth/state-file.ts`, lines 57–71; `packages/cli/src/auth/client.ts`, lines 8 and 25–32.

`resolveStateFilePath` (the new manager) resolves `PRISMA_AUTH_FILE`, then `PRISMA_COMPUTE_AUTH_FILE`, then the default. `getAuthFilePath` (used by `FileTokenStorage`, which the legacy shell, `makeGetCredentials` and `storeLegacyCredential` all go through) resolves only `PRISMA_COMPUTE_AUTH_FILE` and the default. So `PRISMA_AUTH_FILE`, the variable the deprecation warning in `packages/cli/src/v8/runtime.ts` lines 52–58 tells users to switch to, moves the file for one of the two shells and not the other. During the port both shells are live in the same install, and the design's whole premise is "one file, one world".

**Suggestion:** have `getAuthFilePath` delegate to `resolveStateFilePath(env).filePath` so both spellings resolve identically for every reader, and add a test that sets `PRISMA_AUTH_FILE` and asserts `new FileTokenStorage(env)` and `new FileCredentialManager({ env })` agree on the path.

### F09 — The v8 lock and the legacy refresh lock share a path but disagree about when a holder is stale

**Location:** `packages/cli/src/auth/state-file.ts`, lines 14 and 222; `packages/cli/src/auth/token-storage.ts`, lines 60–62 and 176–181.

Both implementations use `${authFilePath}.lock` and both create it with `open(path, "wx")`, so they do exclude each other — which is fortunate and, as far as I can tell, unplanned. But the legacy `FileTokenStorage.withRefreshLock` is handed to the SDK as its refresh hook, so it holds that lock across the whole token exchange, and its stale threshold is 30 seconds to accommodate that. The v8 manager's threshold is 5 seconds, because no network call ever runs under its lock. A v8 process therefore treats a legacy process's live, in-flight refresh as a crashed holder after 5 seconds and deletes its lock. Both then write the same auth file with no mutual exclusion.

The window is narrow (a token exchange slower than 5 seconds) and only opens while both shells are installed, which is the whole S2 port period.

**Suggestion:** the cheapest fix is to raise the v8 stale threshold above the legacy one for as long as both shells coexist, and add a comment in both files recording that the two implementations share the path. Removing it in S2d, when the legacy shell is deleted, is the natural close-out.

### F10 — The process pin is not memoized across concurrent first reads, and the first read hits the file twice

**Location:** `packages/cli/src/auth/credential-manager.ts`, lines 97–128.

`currentSession()` checks `#pin.kind === "unpinned"`, then `await`s `readCredentialState`, then assigns `#pin`. Two callers that reach the check before either assignment both read the file and both write the pin; if another process moved the marker between the two reads, the two callers return different sessions and the surviving pin is whichever resolved last. The design's rule is "pinned ONCE, at first read". Today the auth commands serialise their calls, so this is latent rather than live — but `ctx.session()` and the lazy `ctx.api` construction both call `currentSession()`, and any future command that starts them together (`Promise.all`) would reach it.

The same function also reads the state file twice on the first call: once to resolve the marker, once to find the record.

**Suggestion:** memoize a pin *promise* rather than a pin value, and resolve the record from the state that established the pin.

```ts
#pinning: Promise<Pin> | undefined;
// currentSession():
this.#pinning ??= this.#resolvePin();
const pin = await this.#pinning;
```

### F11 — `#refuseBlankEnvironmentToken` calls a getter purely for its throw and discards the result

**Location:** `packages/cli/src/auth/credential-manager.ts`, lines 337–342.

The method body is `this.#environmentToken();` with the value dropped. It works because `environmentServiceToken` throws on a blank value, and a test does hold the behaviour down. But a statement whose only effect is an exception from a function that looks like an accessor is the kind of thing a cleanup pass or an unused-expression lint rule deletes. The comment explains the intent but does not make the code express it.

**Suggestion:** make the check explicit — extract an `assertEnvironmentTokenNotBlank(env)` in `service-token.ts` that reads as an assertion, or inline the blank test here so what is being checked is visible without following the call.

### F12 — The `chmod` after rename is dead code, and a failed takeover is debug-logged as a successful one

**Location:** `packages/cli/src/auth/state-file.ts`, line 189 and lines 280–282.

Line 189 chmods the state file to 0600 after the rename. The temp file was already created with mode 0600 and `umask` can only clear bits, so after the rename the file's mode is already at most 0600 — the chmod can never tighten anything. Its `.catch(() => {})` also means that if it ever did matter, the failure would be invisible. The test at `packages/cli/tests/credential-manager.test.ts` lines 105–112 ("tightens permissions looser than 0600") passes on the rename alone and would still pass with line 189 deleted.

Separately, lines 280–282 write `lock taken over from a crashed holder` to the debug log *before* attempting the unlink, and the unlink's failure is swallowed — so the one signal an operator has for lock contention can report a takeover that did not happen. This is the same swallowed failure as F03; the logging half is worth fixing even if F03 is fixed differently.

**Suggestion:** delete the chmod (the atomic-rename comment above `writeCredentialState` already explains why the mode is right), and log the takeover only after the removal succeeds.

### F13 — The test harness's credential manager disagrees with production on three error paths

**Location:** `packages/cli-engine/src/testing-credential-manager.ts`, lines 219–224, 305–325 and 372–379.

The harness is the seam every ported command in S2b/S2c/S2d will test against, so where it disagrees with `FileCredentialManager` the disagreement propagates. Three places currently differ:

- **Claim mismatch on rotation** (lines 219–224) throws a plain `Error`; production throws the structured `AUTH.CREDENTIAL_WORKSPACE_MISMATCH`. The sibling case immediately above (line 217) was deliberately changed to raise the production error in commit `47e53c0` for exactly this reason; this one was not.
- **A blank or whitespace environment token** is not modelled at all. `refuseUnderEnvironmentSession` (lines 372–379) treats `environmentToken: ""` as a live override and raises `AUTH.ENV_SESSION_IN_FORCE`, where production raises `AUTH.SERVICE_TOKEN_EMPTY`. A command's blank-token behaviour can only be proven against the real manager.
- **An undecodable environment token** (lines 305–325) makes the harness throw a harness-only error; production composes a session with `workspaceId: ""` and carries on. The design's fixture list explicitly calls for "an undecodable token", and through the harness that fixture cannot exist.

**Suggestion:** raise `credentialWorkspaceMismatchError` from the harness's `setTokens`; run the seeded `environmentToken` through the same trim-and-refuse rule as `environmentServiceToken`; and let an undecodable seed compose the same empty-workspace session production does rather than throwing.

### F14 — Two ref-matching behaviours were dropped from `workspace use` and `workspace logout` without being recorded

**Location:** `packages/cli/src/v8/auth/session-ref.ts`, lines 16–37; compare `packages/cli/src/auth/token-storage.ts`, lines 761–777; `.drive/projects/prisma-cli-v8/assets/s2/parity-divergences.md`, lines 138–141.

The legacy `workspaceMatchesRef` matched a ref against five things: the credential workspace id, the hydrated display id, either of those with the `wksp_` prefix stripped, and the cached name. `resolveSessionRef` matches exactly two: the workspace id, then the case-insensitive name. So `prisma auth workspace use acme` (against `wksp_acme`) worked before and now fails with `AUTH.NO_SESSION_FOR_WORKSPACE`, and a user who was passing the hydrated display id has the same experience. The divergence record covers the name-matching change ("legacy matched names exactly") but says nothing about the dropped prefix stripping or the display id, and the standing S2 rule is that divergences are enumerated rather than discovered.

**Suggestion:** either restore prefix-insensitive id matching in `resolveSessionRef` (three lines, and the ambiguity handling already exists), or add both dropped forms to the divergence record's `workspace use` section. Restoring it is the cheaper answer for users, since the error message tells them to run `auth login` — advice that will not help someone who simply typed the id without its prefix.

### F15 — `ctx.api`'s proxy makes every property look like a method

**Location:** `packages/cli-engine/src/execution/api-client.ts`, lines 56–92.

The `get` trap returns an async function for every string property. `typeof ctx.api.anything === "function"` is always true, a misspelled method surfaces as a `TypeError` only when called and only after the SDK has been constructed, and any non-function property on the SDK client (a nested namespace object, a version field) is unreachable through `ctx.api`. Today's `ManagementApiClient` is flat, so nothing is broken; the cost is that the failure mode for a typo is deferred and confusingly worded, and the proxy quietly constrains what shapes the SDK client may take in future.

**Suggestion:** leave the behaviour as is but state the constraint in the comment above `buildManagementApiClient` — "every member of `ManagementApiClient` must be an async method; nested namespaces would not survive this proxy" — so the next SDK upgrade that adds one is caught by a reader rather than at runtime.

## Deferred (out of scope for this pull request)

- **The legacy `FileTokenStorage` swallows every read error and returns `null`** (`packages/cli/src/auth/token-storage.ts`, lines 217–220), so an unreadable auth file presents as "signed out" to the legacy shell. This is pre-existing behaviour that moved unchanged under the contract's "zero behaviour change" rule for the `git mv`, and the file is scheduled for deletion in S2d. Fixing it here would change legacy-shell behaviour that this slice deliberately froze.
- **No directory `fsync` after the rename in `writeCredentialState`.** The design's durability requirement (fsync the file, then rename) is met literally, and the failure mode after a power loss mid-rotation is a dead token pair that `prisma auth login` fixes. Adding a directory fsync is a broader durability decision that should be taken once for every atomic write in the repo (the telemetry config and the update-check cache have the same shape) rather than in this pull request.
- **`DO_NOT_TRACK` is honoured only for the exact value `"1"`** (`packages/cli-telemetry/src/gating.ts`), where the community convention treats any non-empty, non-zero value as an opt-out. The contract requires the ORM CLI's gating resolution to be preserved unchanged, so changing it here would violate the slice's own instruction. Worth raising as its own question against the ORM CLI.
- **`@prisma/cli-engine` is not yet published.** Acceptance item 1 is an operator action that by design happens after this pull request lands.

## Already addressed on this branch

| Item | Where it was fixed |
| --- | --- |
| The request-failure mapping checked the refresh path before checking for a structured error, so a session ended by another process mid-rotation surfaced as the transient "try again" error. Nothing held the order down; a test now fails when it is swapped. | `47e53c0` |
| The test harness's `TokenStorage.setTokens` threw a plain error where the real manager throws a structured one, which made the case above unreachable in tests. | `47e53c0` |
| The engine built the environment bearer from the raw variable while the manager composed the session from the trimmed value, so `PRISMA_SERVICE_TOKEN=" tok "` sent a padded bearer. Both now trim, with a test asserting the header. | `47e53c0` |
| The debug valve echoed the token endpoint's `error_description` verbatim. It now logs only the endpoint's verdict. | `47e53c0` |
| The reads-never-write probe did not spy the synchronous filesystem calls and had a positive control on `rename` only. | `47e53c0` |
| A refresh failure that was not an `AuthError` escaped as the raw cause instead of mapping to `CLI.AUTH_SERVICE_ERROR`; the mapping now has tests that fail when it is reverted. | `54414f5` |
| The two-process refresh test never reached the replay, because the JWT minter is pure and every token for one workspace came out byte-identical. Tokens now carry a marker claim and the scripted endpoint holds both requests until both arrive. | `54414f5` |
| The leak scan did not cover all three refresh-failure shapes with the debug valve open. | `54414f5` |
| Partial, unverified remediation state (no suite had been run against it). | superseded by `54414f5` and `47e53c0`; all suites now green |

## Acceptance-criteria verification

### Slice contract — `s2a-foundations.md`, Acceptance section

| AC | Verdict | Detail |
| --- | --- | --- |
| A1: Operator has published `@prisma/cli-engine` (metadata PR landed first) | **NOT VERIFIED** | The metadata is complete and correct against §1 as amended by the version erratum: `packages/cli-engine/package.json` carries `version: "8.0.0-rc.1"`, `license: "Apache-2.0"`, `files: ["dist","README.md","LICENSE"]`, `publishConfig.access: "public"`, `engines.node: ">=22.12.0"`, `prepack: "pnpm run build"`, `repository.directory: "packages/cli-engine"`, plus `homepage`, `bugs` and `description`; `LICENSE` and `README.md` exist. The publish itself is an operator action that has not happened and cannot be verified from the branch. |
| A2: `ctx.api` on the context with the harness `client` override; draft amended; refresh-pickup test green | **PASS** | `packages/cli-engine/tests/management-api.test.ts` line 182 asserts the injected client *is* `ctx.api`; line 198 asserts nothing is constructed for a run that never issues a request (via a throwing fake); line 231 asserts one construction per run and checks the actual `Authorization` header; line 212 asserts the unauthenticated touch settles as `CLI.CREDENTIALS_REQUIRED` at exit 2. Refresh pickup, whose mechanism changed with the session model, is proven by line 270 (a 401 refreshes through the manager's view, retries, and the rotated pair lands in the store) and by `packages/cli/tests/credential-manager.test.ts` "re-reads the file on every getTokens". |
| A3: Auth module extracted; legacy shell green against it; v8 runtime consumes `makeGetCredentials` from it | **PASS** | `packages/cli/src/auth/index.ts` is the single public face and exports the contract's list plus the erratum's additions. `packages/cli/src/v8/runtime.ts` line 16 imports `makeGetCredentials` from `../auth`. The full `@prisma/cli` suite, which includes the legacy-shell tests, exits 0. |
| A4: All six `auth *` commands on the engine, over the credential manager, with semantic tests; fixture-only flags gone; `logout --workspace` gone; divergence list updated | **PASS** | Six command modules exist under `packages/cli/src/v8/auth/`; each declares `managesCredentials` where the contract requires it and `whoami` does not. `login.ts` declares no `args`, so `--provider`, `--user` and `--workspace` are gone; `logout.ts` declares no `args`, so `--workspace` is gone. `packages/cli/tests/v8-auth.test.ts` (806 lines) runs every command through the harness manager with state read-back and asserts envelopes, exit codes and manager state. The divergence record has a rewritten S2a auth section. F14 records two matching behaviours the divergence list omits. |
| A5: Update check ported to both shells; sequencing matches legacy | **PASS** | `packages/cli/src/update-check.ts` exposes a structural `UpdateCheckRuntime`; the legacy shell calls it at `packages/cli/src/cli.ts` line 49 and the v8 bin at `packages/cli/src/v8/main.ts` line 30, both before dispatch. `packages/cli/tests/v8-update-check.test.ts` asserts ordering explicitly (line 102, "writes the notice before the command dispatches (ordering, not just presence)"), the worker spawn arguments (line 177), silence inside the notification interval (line 137), silence in json mode (line 151), and the literal-argv quirk under `--format json` (line 121). The quirk is recorded in the divergence list. |
| A6: Telemetry package ported, hook amendment landed, bin wired, consent commands mounted, sanitizer value-free by test | **PASS** | `packages/cli-telemetry` exists as `@repo/cli-telemetry`, private. `sanitizeEngineSnapshot` emits only the joined command path and the names of `source: "cli"` flags; `positionalCount` is accepted and never read; `packages/cli-telemetry/tests/sanitize.test.ts` and the payload/no-spawn tests hold this down. `onSettled` is wired in `packages/cli/src/v8/main.ts` through `resolveTelemetryHooks`, wrapped in a `try/catch` so a telemetry construction failure cannot break a command; `packages/cli-engine/tests/run-hooks.test.ts` covers firing once and swallowing a throw. All 97 telemetry tests pass. |
| A7: Clack renderer landed per spike; all prompt tests green including the clack-path fixture suite | **PASS** | `packages/cli-engine/src/execution/clack-renderer.ts` exists; `clack-prompts.test.ts` drives confirm/select/text through a fake raw-mode stdin and `clack-isolation.test.ts` proves the harness path never loads clack. The engine suite (244 tests) exits 0. |
| A8: Root verification — engine + cli suites, typecheck, lint exit 0 | **PASS** | Re-run at HEAD: `pnpm --filter @prisma/cli test`, `pnpm --filter @prisma/cli-engine test`, `pnpm --filter @repo/cli-telemetry test`, `pnpm typecheck` and `pnpm lint` all exited 0. |
| A9: PR ≥1k LOC; divergence list reviewed | **PARTIAL** | The size criterion passes outright (18,868 added lines against `origin/main`). "Divergence list reviewed" is an operator action and is not verifiable from the branch; F14 is one item the list is currently missing. |

### Design revision 5, §5 — Required tests

| Required test | Verdict | Detail |
| --- | --- | --- |
| R1: Process pinning — a second process moves the marker mid-run; the running process's requests still carry its pinned session's tokens; a new process picks up the new marker | **PASS** | `packages/cli/tests/credential-manager-processes.test.ts` line 296 spawns real worker processes: it asserts the in-process manager still reports its pinned workspace after a worker switches the marker, and that a freshly spawned worker reports the new one. The "requests carry the pinned tokens" half is proven separately in `packages/cli-engine/tests/management-api.test.ts` line 231, which asserts the bearer on the wire is the pinned session's access token and that the token storage is resolved exactly once. |
| R2: A pinned session ended by a second process fails the next request with the session-ended wording, not the SDK's synthesized message and not the transient error | **PASS** | `packages/cli-engine/tests/management-api.test.ts` line 362 drives a real request whose bound session is gone from stored state and asserts the envelope carries `CLI.CREDENTIALS_REQUIRED` with "has ended"; `packages/cli/tests/credential-manager.test.ts` line 284 asserts the same wording from the real manager after another process ends the session. Commit `47e53c0` added a test that fails if the mapping's ordering is swapped, which is what stops this collapsing into the transient error. |
| R3: Two refreshers on one session across two processes — both complete and the file ends with a valid pair | **PASS** | `credential-manager-processes.test.ts` line 207 spawns two real processes, each running the SDK's refreshing client against a scripted token endpoint that implements the ten-second reuse grace and holds both requests until both arrive. It asserts both exit with HTTP 200, that the endpoint performed exactly two exchanges, and that the stored record is one of the two issued pairs. This is a real test of the server-absorbed race, not a simulation. |
| R4: Rotation writes only the token fields; name and marker untouched; `expiresAt` re-derived; the rotated pair persisted before the new access token reaches the caller | **PASS** | `credential-manager.test.ts` line 561 asserts the record keeps its `name`, gets the new token pair and a re-derived `expiresAt`, and that `currentWorkspaceId` still points at the *other* workspace. Line 748 spies `rename` and asserts it completed before `setTokens` resolved, then reads the rotated token back off disk. |
| R5: `endSession` versus an in-flight rotation — the ended session stays gone | **PASS** | `credential-manager.test.ts` line 588: another manager ends the session, then `setTokens` for it rejects with `CLI.CREDENTIALS_REQUIRED` and the file still holds zero sessions. The assertion on the file contents is what makes this a resurrection test rather than an error-code test. |
| R6: The login flow writes nothing through the manager (throwaway storage; manager file untouched until `createSession`) | **PASS** | `packages/cli/tests/credential-manager-login.test.ts` line 36 asserts `performLogin` returns the minted credential and that the state file is untouched. `packages/cli/src/auth/operations.ts` lines 88–110 confirms the throwaway storage and that custody passes to the caller. |
| R7: `createSession` holds no lock during the name fetch | **PASS** | `credential-manager.test.ts` line 463 blocks the injected `fetchWorkspaceName` mid-flight, completes a *second* manager's `createSession` while it hangs, then releases and asserts both records exist and the name landed. That is the real property, not a proxy for it. |
| R8: `createSession` claim/argument mismatch refusal | **PASS** | `credential-manager.test.ts` line 455 asserts `AUTH.CREDENTIAL_WORKSPACE_MISMATCH` and that no state file was created. |
| R9: The environment session never refreshes (token endpoint not hit on 401) | **PASS** | `management-api.test.ts` line 624 scripts a 401, asserts exactly one fetch call was made, that its URL was the API and not the token endpoint, that the bearer was the env token, and that the failure maps to `AUTH.SERVICE_TOKEN_REJECTED`. Line 647 additionally asserts the bearer is the trimmed value. |
| R10: Env-override matrix — every mutation × {unset, set, blank, whitespace}, error family asserted, state-file bytes unchanged; plus the `endAllSessions` no-op | **PASS** | `credential-manager.test.ts` lines 338–441 iterate `{set, blank, whitespace}` across `useSession`, `endSession`, `endAllSessions` and `createSession`, asserting the error code and comparing the raw file bytes before and after; a separate case covers all four mutations with the variable unset; two further cases cover the zero-session no-op and its legacy-sidecar reaping. This is the fullest matrix in the suite. Note F13: the harness manager cannot reproduce the blank/whitespace half, so command-level coverage of it rests on `packages/cli/tests/v8-auth.test.ts` reading the env directly. |
| R11: End-current / sessions-held-none-current — one shared assertion over `ctx.session()`, the needs check and a bare `ctx.api` touch | **PASS** | `packages/cli-engine/tests/credential-manager.test.ts` line 221 runs all three paths against identical seeds and asserts the three errors are `toEqual` one another, including the `nextActions` array. Asserting equality between the three rather than checking each against a literal is what makes this prove single-sourcing. |
| R12: Reads-never-write probe (filesystem spy; zero writes on every read path including migration adoption) | **PASS** | `credential-manager.test.ts` line 114 spies eleven write entry points across `fs/promises` and `node:fs` (including the synchronous ones, added in `47e53c0`), exercises `currentSession`, `sessions`, `getTokens` and a legacy-adoption read, asserts none fired, then performs a real mutation and asserts `open` and `rename` did fire. The positive control is what makes this a real probe. |
| R13: Token-material leak scan (stdout, stderr, debug logs, error meta, envelopes) | **PASS** | Three complementary tests. `credential-manager.test.ts` line 690 seeds known secrets, exercises every write path with the debug valve open, and scans the debug lines plus the errors serialized over `Object.getOwnPropertyNames`. `credential-manager-processes.test.ts` line 312 scans real worker stdout and stderr across a success and an `invalid_grant` failure. `packages/cli-engine/tests/credential-manager.test.ts` line 560 and `packages/cli/tests/v8-auth.test.ts` line 779 scan stdout, stderr and the serialized json envelope. `management-api.test.ts` line 586 covers all three refresh-failure shapes with the valve open. |
| R14: Lock — two concurrent mutations in different processes both land; a crashed holder's lock is taken over after the stale threshold | **WEAK** | Both halves exist and both use real processes: `credential-manager-processes.test.ts` line 194 spawns three concurrent `createSession` workers and asserts all three records land, and line 245 crashes a worker holding the lock, then asserts the next mutation succeeds and that the debug log records the takeover. What is missing is the case the takeover path actually breaks on: two processes taking over the same stale lock at once, which F02 shows lets both into the critical section and loses one update. The existing takeover test has a single taker, so it passes today and would still pass with the defect in place. |

### Summary

| Result | Count | Criteria |
| --- | --- | --- |
| PASS | 20 | A2, A3, A4, A5, A6, A7, A8; R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13 |
| FAIL | 0 | — |
| NOT VERIFIED | 1 | A1 (publish is an operator action after merge) |
| WEAK | 1 | R14 (the concurrent-takeover case is untested, and F02 shows it is broken) |
| PARTIAL | 1 | A9 (size passes; "divergence list reviewed" is an operator action) |
