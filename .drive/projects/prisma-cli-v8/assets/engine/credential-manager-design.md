# Credential manager — design, revision 5 (normative)

Status: operator-designed session model (2026-08-10), replacing the
rev-3/4 grants model wholesale. Revisions 1–4 and their review folds
are in git history; rev 4's REFRESH, MIGRATION, and LOCKING mechanics
carry forward with vocabulary mapped (grant → session) — those rules
were always about tokens. NORMATIVE for the implementation, which
lands on PR #130. A delta review (architect + PE) covers rev4→rev5.

## 1. The reality this models

Validated against pdp-control-plane source (2026-08-10):

- `prisma auth login` can produce exactly ONE kind of thing: a
  workspace-scoped OAuth token pair (access + refresh). The user
  picks the workspace on the consent screen; the CLI CANNOT request
  or pin a workspace — the authorize request carries no workspace
  parameter (`AuthorizeSearchSchema`). The CLI learns which
  workspace it got by decoding the returned token's `workspace_id`
  claim. Refresh cannot re-scope.
- `PRISMA_SERVICE_TOKEN` supplies a workspace-scoped bearer token
  from the environment. No refresh, never stored.
- Tokens carry identity claims (`sub`: a user for login tokens, a
  workspace for service tokens) but the CLI's stored state records
  and enforces NO identity. Identity surfaces only when `whoami`
  decodes the current session's claims. A wallet MAY hold sessions
  created by different accounts; the system does not care (operator
  ruling — the rev-3/4 one-identity invariant is DROPPED).
- Legacy state: a JSON file of `{workspaceId, accessToken,
  refreshToken}` entries plus a separate context file holding the
  active workspace id. §7 migrates it.

There are no grants and no separate credential registry concept.
The domain is: a set of per-workspace sessions, one current.

## 2. Entities

```ts
/** The proof material. Only ever seen by the login flow (which
 *  mints it) and createSession (which stores it). */
interface Credential {
  readonly token: string;
  readonly refreshToken: string | undefined;
  readonly expiresAt: Date | undefined;
}

interface Workspace {
  readonly id: string;
  readonly name: string | undefined;
}

/** "Logged-in-edness", scoped to a workspace. Identified to users
 *  by its workspace. The token is INTERNAL: it lives in the stored
 *  record but is structurally absent from this public shape. */
interface Session {
  readonly workspaceId: string;
  readonly workspace: Workspace | undefined; // loaded on session create (§4)
  readonly expiresAt: Date | undefined;
  readonly source: "stored" | "environment";
  readonly active: boolean;
}
```

- Sessions are KEYED BY WORKSPACE ID: at most one session per
  workspace. Logging in to the same workspace again upserts the
  stored record (same key, new credential). Creating sessions for
  several workspaces with the same account is fine — one record per
  workspace, whatever credential is inside.
- `whoami`'s identity display comes from decoding the CURRENT
  session's token claims at read time (user id/email for login
  tokens, workspace for service tokens). Identity is a per-session
  decoded fact, not system state.
- `source: "environment"` marks the ephemeral session composed from
  `PRISMA_SERVICE_TOKEN` (§6). It never appears in `sessions()`.

## 3. The CredentialManager interface (the SPI)

Manages sessions. Nothing else.

```ts
interface CredentialManager {
  /** The session the engine is acting as RIGHT NOW — the one the
   *  management API authenticates with. Env token wins over the
   *  stored current (§6). Local-only: decodes claims, never
   *  touches the network. */
  currentSession(): Promise<Session | null>;

  /** The available sessions (auth workspace list). Local-only. */
  sessions(): Promise<readonly Session[]>;

  /** Login's write. The caller names the workspace that identifies
   *  the session (for a workspace-bound credential the manager
   *  verifies the workspace_id claim matches and refuses on
   *  mismatch; for a multi-workspace credential the argument IS
   *  the choice). Upserts by workspaceId, becomes current. Fetches
   *  the workspace name via the management API once, best-effort
   *  (login is already online; failure leaves name undefined —
   *  never fails the login). */
  createSession(credential: Credential, workspaceId: string): Promise<Session>;

  /** Switch the current session. */
  useSession(session: Session): Promise<Session>;

  /** Log out of one workspace: remove that session. If it was
   *  current, there is no current (no auto-promotion). */
  endSession(session: Session): Promise<void>;

  /** Log out entirely: remove all sessions and the current marker
   *  (also reaps legacy files, §7). */
  endAllSessions(): Promise<void>;
}
```

Interface rules:
- The manager never talks to the user (no prompts, no browser).
  The login FLOW lives beside it; `performLogin` returns the minted
  credential and the command calls `createSession`.
- The manager resolves NO user input. Commands resolve what the
  user typed against `sessions()` themselves (exact id, then
  case-insensitive name; ambiguity is the command's error) and pass
  the matched `Session`. Manager errors are real state errors only —
  e.g. the passed session no longer exists (another process ended
  it) → structured error, nothing guessed.
- `useSession`/`endSession` identify the target by its
  `workspaceId` against freshly-read state under the lock (§8) —
  the Session object is a reference, not a snapshot to trust.
- Env is a construction input (injected `env`, never `process.env`
  below the manager). Exactly one env var names the state file; the
  legacy second variable is a deprecated, warned alias.
- Error single-sourcing: blank/whitespace service token → one
  structured error raised identically from `currentSession()`, the
  needs check, and the engine's token resolution; unreadable file →
  `CLI.CREDENTIALS_UNREADABLE`; parse-corrupt file → signed out
  (self-heals on next login), never an exception, never a write.

Mutations under an env override (`PRISMA_SERVICE_TOKEN` set):
`useSession`, `endSession`, `endAllSessions` refuse with one
structured error family (why names the env var and whether stored
sessions exist; nextAction is the literal `unset` command).
`createSession` is ALLOWED with a mandatory one-line notice that the
env token remains in force until unset. Reads work normally, and
`auth workspace list` states that the env session is what is in
force (normative).

## 4. Engine integration

- `Runtime.credentialManager: CredentialManager` replaces
  `Runtime.getCredentials`, staged as before (optional first, then
  needs/api rework, then `getCredentials` deletion).
- `ctx.session(): Promise<Session | null>` on EVERY context —
  read-only, local-only (tested: no network I/O). It serves
  `currentSession()`.
- `managesCredentials: true` capability puts `ctx.credentialManager`
  on the context for exactly: `auth login`, `auth logout`,
  `auth workspace list`, `auth workspace use`,
  `auth workspace logout`. `whoami` uses `ctx.session()` only.
- **The ENGINE constructs and owns the management API client**
  (`ctx.api`), as it did in S2a. Construction config (real OAuth
  client id, base URL) is injected by the bin beside the manager —
  the engine's placeholder constants die. The client is cached per
  workspace id and rebuilt when the current session changes (a
  command that switches and then touches `ctx.api` must get a
  client for the NEW session). Refresh single-flight is per client,
  which is correct because refresh is per session.
- **The manager's one internal seam**: it implements the SDK's
  `TokenStorage` contract (`getTokens` / `setTokens` /
  `clearTokensIfCurrent` / `withRefreshLock`) so the SDK's 401 →
  refresh → retry cycle reads and writes the session store under
  the manager's rules (§6). The storage view handed to a client is
  bound to THAT client's session's workspace id — bound to the ID,
  never to a credential snapshot: `getTokens` re-reads the store on
  every call. This seam is engine↔manager plumbing; it is not part
  of the user-facing SPI and token material never crosses the
  public interface.
- Harness: `createTestCli` seeds `{ sessions?: [...], currentWorkspaceId?,
  credential? }` over a mutable in-memory manager with full state
  read-back. Fixture surface and required tests: §5.

## 5. Fixtures and required tests

Fixture surface: injectable token endpoint (script 401 → rotated
pair → retry; `invalid_grant`; 5xx/network-throw), a JWT minter
(`sub`, `workspace_id`, `exp`, `email` + an undecodable token), a
legacy-store builder (pointer valid/dangling/null/absent; one/many
entries; corrupt context; wrong shape), a deterministic clock, an
interleaving hook (pause between read-under-lock and write), and a
way for a real second process to hold the lock.

Required tests:
- multi-process races (real filesystem): `useSession` vs rotation
  (final state = the switch + the rotated tokens); `endSession` vs
  rotation (no resurrection); two refreshers (exactly one exchange);
- env-override matrix: every mutation × {unset, set, blank,
  whitespace} — error family asserted, state file bytes unchanged;
- end-current / sessions-held-none-current: one shared assertion
  over `ctx.session()`, the needs check, and a bare `ctx.api` touch;
- workspace-name persistence across refresh (the legacy regression:
  rotation must not touch `workspace.name`), with `expiresAt`
  re-derived;
- reads-never-write probe (filesystem spy: zero writes on every
  read path including migration adoption);
- token-material leak scan (seed a known secret; assert absent from
  stdout, stderr, debug logs, error meta, envelopes);
- lock-constant ordering (§8);
- `createSession` claim/argument mismatch refusal.

## 6. Runtime flows (normative)

**Unauthenticated.** `needs.credentials` → `CLI.CREDENTIALS_REQUIRED`
(exit 2, sign-in nextAction) before the handler loads; bare
`ctx.api` touch → same error at request time. `whoami` → "signed
out", exit 0. No auto-login.

**Sessions held, none current** (migration rows; end-current): same
code, distinct why ("you have workspace sessions but none is
current") with nextActions `auth workspace use` and login.

**Refresh.** Driven by the SDK on 401 through the manager's
`TokenStorage` view (§4), under the mandatory lock (§8):
- `setTokens` (the rotation write — the write that runs on every
  successful refresh): updates IN PLACE only `token`,
  `refreshToken`, `expiresAt` (re-derived from claims; the SDK's
  pair carries no expiry) of its own session record. NEVER creates
  a session, NEVER moves the current marker, NEVER touches
  `workspace.name`. If the freshly-read state has no record for
  that workspace id (another process ended it), refuse and throw —
  no resurrection. If the new token's `workspace_id` claim
  disagrees with the bound id, refuse (refresh cannot re-scope).
- `clearTokensIfCurrent`: remove the session iff its stored
  credential still exactly matches the pair that failed — "exactly"
  over the SDK's three compared fields (`workspaceId`,
  `accessToken`, `refreshToken`) only, so a re-derived expiry can't
  defeat the match. Clear the current marker only if it names that
  session. (The SDK comparing ACCESS tokens too is desired: a pair
  another process already rotated correctly declines to clear.)
- Preemptive refresh is PROHIBITED (outside the SDK's single-flight
  it can spend a one-time refresh token and convert an optimization
  into a false sign-out).

**Refresh failure discrimination.** `AuthError.refreshTokenInvalid`
is `true` only for HTTP 4xx + body error exactly `invalid_grant` —
the definitive sign-out trigger:
- `true` → `CLI.CREDENTIALS_REQUIRED`, expiry wording. The SDK has
  already cleared; the manager debug-logs endpoint status + error
  value BEFORE the clear.
- any other `AuthError` → the manager re-reads its state: session
  gone → `CLI.CREDENTIALS_REQUIRED` with session-ended wording;
  otherwise a transient auth-service error. A state check, never
  message parsing.
- non-auth failures (network, 5xx) → transient auth-service error;
  NOTHING cleared.
The SDK version is exact-pinned; a test asserts clearing happens on
`invalid_grant` and nothing else.

**Service token (env).** Composes as an ephemeral current session
(`source: "environment"`), never stored, absent from `sessions()`.
No refresh; 401 → structured error naming the env var; nothing
cleared. `whoami` notes the override when stored sessions also
exist. Blank/whitespace → the single blank-token error (§3).

**Lock contention.** A refresh-lock wait timeout is its own
structured code with a why naming the lock path and a next action.

**Debug valve.** `PRISMA_NEXT_DEBUG` shape: source won, resolved
state-file path, refresh attempted, endpoint status + error field,
lock acquire/release/steal with holder ids. Token material NEVER
appears in any log, error, meta, or envelope.

## 6a. The commands

Legacy names return unchanged — the session model makes them honest
("log in to a workspace" = create a session for it):

- `auth login` — browser consent flow; the user picks the
  workspace; `createSession(credential, workspaceId-from-claims)`.
- `auth logout` — `endAllSessions()`.
- `auth whoami` — `ctx.session()` + claims decode; `ctx.api`
  enrichment when online.
- `auth workspace list` — `sessions()`, current marked.
- `auth workspace use <ref>` — resolve ref against `sessions()`
  (command-side), `useSession(match)`.
- `auth workspace logout <ref>` — resolve, `endSession(match)`.
  (The rev-3 `workspace forget` rename is DEAD; legacy vocabulary
  stands. The rev-3/4 grants vocabulary is dead everywhere.)

**OPEN OPERATOR RULING — `use X` with no session for X.** The
consent flow cannot target a workspace (§1), so "use acquires X" is
unimplementable as promised in rev 3/4. Options:
(a) legacy-parity error: "no session for X — run `prisma auth
login` and pick X in the browser" (no browser launch from `use`);
(b) `use X` announces it is opening the browser, runs the generic
flow, then compares the returned `workspace_id` to X: match →
create + current; mismatch → create the session it actually got
(real consent, not wasted), leave the current marker unchanged, and
say "you logged in to Y, not X". Recommendation: (b). Built to (a)
until ruled — (a) is a subset of (b), so (b) adds on top without
rework.

## 7. Migration from the legacy store

Governing rule unchanged: **the migration read writes nothing.**

| Legacy store state | Rule |
| --- | --- |
| Context file exists, pointer targets an existing entry | All entries adopted as sessions; that one current |
| Context exists, pointer dangles | All adopted; NO current |
| Context exists, `activeWorkspaceId: null` | All adopted; no current |
| No context, exactly one entry | Adopted, current |
| No context, multiple entries | All adopted; NO current (no coin flip) |
| Auth file missing / unparseable / wrong shape | No sessions. Never delete, never rewrite |

The rev-4 mixed-identity rule is DELETED: the wallet is
identity-blind (operator ruling), so ALL decodable entries adopt
regardless of `sub`. Entries whose token does not decode to a
`workspace_id` are ignored (they cannot be keyed).

The adopted view materializes into the new single-file format on
the first mutation (`createSession` / `useSession` / `endSession` /
`endAllSessions` / refresh rotation), writing the FULL adopted set.
After that the legacy files are ignored entirely; until then they
stay untouched so a still-installed legacy CLI keeps working.
`endAllSessions` clears everything including legacy files. New
writes use mode 0600 and tighten looser permissions on first write.
Names carried by legacy entries adopt onto the sessions.

## 8. Locking and atomicity

- **One file** holds the whole state, shape normative:
  `{ version, sessions: [{ workspaceId, name?, token,
  refreshToken?, expiresAt? }], currentWorkspaceId | null }`. No
  context sidecar. Every write replaces the whole state.
- **Writes are atomic**: temp file, fsync, rename; 0600.
- **Reads never write; reads take no lock** (atomic rename
  guarantees a complete state).
- **One advisory lock, every mutation** — the four SPI mutations
  plus refresh's `setTokens`/`clearTokensIfCurrent`.
  `withRefreshLock` is implemented (mandatory).
- **Re-entrant per lock file per process** via an owner token
  SHARED between the manager and the `TokenStorage` view the SDK
  holds (the SDK calls the token writes from INSIDE
  `withRefreshLock`; per-instance re-entrancy would deadlock). The
  legacy `lockSetTokens: false` bypass does not survive — correct
  re-entrancy makes it unnecessary.
- **Heartbeated**: holder touches the lock ~5s; pid/hostname/start
  recorded; steals debug-logged. Constant ordering normative and
  complete: heartbeat < exchange timeout < stale threshold < wait
  timeout, stale ≥ 4× heartbeat (legacy had wait 25s < stale 30s —
  a crashed holder produced contention errors instead of recovery).
  A test asserts the constants' ordering.
- **Every mutation re-reads under the lock** and owns only its
  slice:

  | Mutation | May modify |
  | --- | --- |
  | `setTokens` (rotation) | `token`/`refreshToken`/`expiresAt` of its own record |
  | `clearTokensIfCurrent` | removes its own record; current marker only if it names it |
  | `useSession` | current marker only |
  | `endSession` | one record; current marker if it named it |
  | `createSession` | one record (upsert) + current marker |
  | `endAllSessions` | whole state |

  No mutation writes state read before lock acquisition.
- **Rotation durability**: rotated pair persisted (fsync + rename)
  before the new access token reaches any caller.

## 9. Change surface on PR #130

Engine (`packages/cli-engine`): rename/reshape pass over the landed
engine-surface commit (a8ef3fb): the rev-4 entity trinity
(Session-as-read/Credential/GrantSummary/Identity union + method
axis) becomes §2's `Session`/`Credential`; the manager interface
becomes §3's six methods (`apiClient` and `rememberWorkspaceName`
deleted from the SPI); engine-side client construction returns
(with injected config); §6 error mapping kept; harness seeding
reshaped; draft amendments updated.

Auth module (`packages/cli/src/auth`): the manager implementation
(§7 migration, §8 locking, TokenStorage seam, name fetch in
`createSession`); `performLogin` returns the credential. Legacy
operations remain for the legacy shell until S2d.

v8 tree (`packages/cli/src/v8`): auth family onto the manager with
LEGACY names (`workspace-logout.ts` stays; no forget). `logout
--workspace`: does not return (superseded by `workspace logout`).

Docs: parity-divergences auth sections rewritten AGAIN — now
smaller (rename class gone; remaining divergences: error-code map,
exit unifications, whoami shape, env-override mutation refusals,
orphan-reaping logout); s2a contract §3/§4/acceptance amended; S2
overview auth rows.

## 10. Disposition record

Rev 5 (2026-08-10): operator-designed session model replaces the
grants model. Reversals, all operator-ruled: per-workspace session
vocabulary is CORRECT (a session per workspace, keyed by workspace
id) — the rev-2..4 "no per-workspace sessions" stance is dead; the
one-identity invariant is dropped (wallet is identity-blind, like
legacy); `workspace forget` rename dead, legacy command names
return; grants/GrantSummary/Identity-union deleted; `apiClient()`
and `rememberWorkspaceName` deleted from the SPI (engine constructs
the client with injected config; workspace names fetched once in
`createSession`). Carried from rev 4 unchanged: refresh/rotation
rules, failure discrimination, migration read-writes-nothing,
locking contract, fixture/test list, env-override split
(`createSession` allowed with notice). Open: §6a `use X` not-held
behavior (built to (a), recommendation (b)).
