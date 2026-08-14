# Credential manager — design, revision 5 (normative, final)

Status: operator-designed session model (2026-08-10). Rev 5 replaced
the rev-3/4 grants model; this final text folds the delta review
(architect + PE) AND the operator's process-pinning concurrency
ruling, which deletes most of the reviewed locking machinery — §10
records what was adopted and what that ruling made moot. Revisions
1–4 are in git history. NORMATIVE for the implementation on PR #130.

## 1. The reality this models

Validated against pdp-control-plane source (2026-08-10):

- `prisma auth login` can produce exactly ONE kind of thing: a
  workspace-scoped OAuth token pair (access + refresh). The user
  picks the workspace on the consent screen; the CLI CANNOT request
  or pin a workspace — the authorize request carries no workspace
  parameter (`AuthorizeSearchSchema`). The CLI learns which
  workspace it got by decoding the token's `workspace_id` claim.
  Refresh cannot re-scope.
- Refresh tokens are single-use WITH a 10-second reuse grace
  (`StaticClientOAuthProvider`: rotation marks the token used; one
  replay within 10s succeeds and issues its own pair; later replays
  are `invalid_grant`). Rotation does not revoke sibling pairs — 
  any successfully issued pair remains valid on its own. Racing
  refreshes are therefore SERVER-ABSORBED: whichever write lands
  last, the file holds a working pair. Client-side coordination
  beyond in-process dedup is unnecessary.
- `PRISMA_SERVICE_TOKEN` supplies a workspace-scoped bearer token
  from the environment. No refresh, never stored.
- Tokens carry identity claims (`sub`) but the stored state records
  and enforces NO identity (operator ruling). A wallet MAY hold
  sessions created by different accounts; identity surfaces only as
  a read-time claim decode (`whoami`).
- Legacy state: a JSON file of `{workspaceId, accessToken,
  refreshToken}` entries plus a context sidecar holding the active
  workspace id. §7 migrates it.

The domain: a set of per-workspace sessions, one current.

## 2. Entities

```ts
/** The proof material. Only ever seen by the login flow (which
 *  mints it) and createSession (which stores it). */
interface Credential {
  readonly token: string;
  readonly refreshToken: string | undefined;
  readonly expiresAt: Date | undefined;
}

/** "Logged-in-edness", scoped to a workspace. Identified to users
 *  by its workspace. The token is INTERNAL: it lives in the stored
 *  record, never on this public shape. */
interface Session {
  readonly workspaceId: string;
  readonly workspaceName: string | undefined; // fetched once at creation (§3)
  readonly expiresAt: Date | undefined;
  readonly source: "stored" | "environment";
  readonly current: boolean;
}
```

- Sessions are KEYED BY WORKSPACE ID: at most one session per
  workspace. Logging in to the same workspace again upserts the
  record (same key, new credential) — whichever account minted it;
  the store cannot hold two credentials for one workspace and does
  not try (accepted, matches legacy). A credential backs at most
  one session (never store one refresh token under two keys).
- The marker is called CURRENT everywhere (state field
  `currentWorkspaceId`, list flag `current`, read
  `currentSession()`).
- `source: "environment"` marks the ephemeral session composed from
  `PRISMA_SERVICE_TOKEN` (§6). It never appears in `sessions()`.
- `whoami` decodes the current session's claims at read time.

## 3. The CredentialManager interface (the SPI)

Manages sessions: six user-facing operations plus one engine-facing
accessor (flagged §10; it exposes a capability the SDK consumes,
never token material to engine code).

```ts
interface CredentialManager {
  /** The session this PROCESS is acting as. Pinned at first read
   *  (§4): composed from the env token if set, else the file's
   *  current marker at that moment; later marker changes by other
   *  processes do not move it. This process's own mutations
   *  (createSession/useSession/endSession/endAllSessions) DO
   *  update it. Local-only: never touches the network. */
  currentSession(): Promise<Session | null>;

  /** The available sessions (auth workspace list), read fresh from
   *  the file. Local-only. Under an env override the file's
   *  current marker is still shown as `current` and the listing
   *  command states the env session is what is in force. */
  sessions(): Promise<readonly Session[]>;

  /** Login's write. The caller names the workspace that identifies
   *  the session; for workspace-bound credentials the manager
   *  verifies the workspace_id claim matches and refuses on
   *  mismatch (a future multi-workspace credential makes the
   *  argument a real choice). Upserts by workspaceId, sets the
   *  file marker, becomes this process's current. The workspace
   *  name is fetched best-effort AFTER the write, outside the lock
   *  (§8), via the injected lookup — failure leaves it undefined,
   *  never fails login. */
  createSession(credential: Credential, workspaceId: string): Promise<Session>;

  /** Switch: sets the file's current marker AND this process's
   *  pinned session. */
  useSession(session: Session): Promise<Session>;

  /** Log out of one workspace: remove that session. If it was
   *  current (file marker or this process's pin), that current is
   *  cleared (no auto-promotion). */
  endSession(session: Session): Promise<void>;

  /** Log out entirely: remove all sessions and the marker (also
   *  reaps legacy files, §7). Returns nothing: the COMMAND reports
   *  how many it ended, by calling `sessions()` before this. */
  endAllSessions(): Promise<void>;

  /** ENGINE-FACING, not a user operation: the SDK TokenStorage
   *  view for one workspace's session. The engine forwards it into
   *  SDK client config and never calls its methods itself. */
  tokenStorage(workspaceId: string): TokenStorage;
}
```

Interface rules:
- The manager never talks to the user and never opens a browser.
  `performLogin` returns the minted credential; the login command
  calls `createSession`. The login flow's own SDK instance uses a
  THROWAWAY in-memory TokenStorage (the SDK persists tokens through
  its storage at callback time; that write must never reach the
  manager — minting and custody stay separate). The manager's
  storage is reachable only through `tokenStorage()`.
- Construction dependencies (injected by the bin): `env` (no
  library below the manager reads `process.env`; `PRISMA_AUTH_FILE`
  names the state file, `PRISMA_COMPUTE_AUTH_FILE` is the warned
  deprecated alias) and
  `fetchWorkspaceName(credential, workspaceId)` (the manager
  constructs no API client).
- The manager resolves NO user input. Commands resolve refs against
  `sessions()` (exact id, then case-insensitive name; ambiguity is
  the command's error) and pass the matched Session.
- `useSession`/`endSession` treat the argument as a WORKSPACE
  reference: only `workspaceId` is read, re-validated against
  freshly-read state under the lock. If another process replaced
  that workspace's session in between, the operation applies to the
  replacement (the intent — switch to or log out of the workspace —
  is workspace-keyed). No session for that workspace → structured
  error. Passing a `source: "environment"` session is a misuse →
  the same error. `useSession` on the already-current session
  succeeds and changes nothing.
- Error single-sourcing: blank/whitespace service token → one
  structured error raised identically from `currentSession()`, the
  needs check, and the engine's request path; unreadable file →
  `CLI.CREDENTIALS_UNREADABLE`; parse-corrupt file → signed out
  (self-heals on next login), never an exception, never a write.

Mutations under an env override (`PRISMA_SERVICE_TOKEN` set):
- `useSession`, `endSession` refuse with one structured error
  family (why names the env var and whether stored sessions exist;
  nextAction is the literal `unset` command).
- `endAllSessions` refuses when stored sessions exist and SUCCEEDS
  AS A NO-OP when there are none (CI teardowns running `prisma
  auth logout` with only the env token must not fail). Accepted,
  stated: while the var is set, existing stored state cannot be
  cleared.
- `createSession` is ALLOWED with a mandatory one-line notice that
  the env token remains in force until unset.
- Reads work normally.

## 4. Process pinning and engine integration

**Process pinning (operator ruling).** A CLI process determines its
session ONCE: env token if set, else the file's current marker at
first read. That session is the process's identity for its entire
lifetime — another process switching the marker or replacing
records does NOT redirect a running process; new processes pick up
the new marker. The process's own auth mutations are the only thing
that move its pin. Consequences, normative:
- ONE stored-session API client per process, built lazily for the
  pinned session and memoized for the run (no per-access
  re-resolution, no cache invalidation machinery, no
  "session-replaced" errors). The SDK's per-client refresh
  single-flight therefore IS the per-process refresh dedup.
- Refresh writes are keyed by the pinned session's workspace id
  ("by session identity"). Cross-process refresh races on the same
  session need no client-side coordination (§1: server grace +
  sibling-pair validity make either winner fine). The SDK's
  compare-and-clear handles the stale-replay case benignly.
- A process whose pinned session is ended by another process
  mid-run fails at its next request with the session-ended wording
  (§6) — the honest outcome; nothing tries to re-pin.

Engine integration:
- `Runtime.credentialManager: CredentialManager` replaces
  `Runtime.getCredentials`, staged as before. The bin also injects
  the CLIENT CONFIG: `{clientId, redirectUri, apiBaseUrl,
  authBaseUrl}` — all four (the SDK's refreshing fetch requires the
  full config even though only login paths read redirectUri). The
  same config feeds `performLogin`. The engine's placeholder
  constants stay deleted; the construction test seam RETURNS via
  this injected config (harness points it at a local server).
- `ctx.session(): Promise<Session | null>` on EVERY context —
  read-only, local-only (tested: no network I/O). Serves
  `currentSession()` (the pin).
- `managesCredentials: true` puts `ctx.credentialManager` on the
  context for exactly: `auth login`, `auth logout`, `auth workspace
  list`, `auth workspace use`, `auth workspace logout`. `whoami`
  uses `ctx.session()` only.
- **The ENGINE constructs and owns the management API client**
  (`ctx.api`): the pinned session's client, once per process.
  Stored session → the SDK's refreshing path with
  `tokenStorage(workspaceId)` in the config. Env session → the
  SDK's static-token path (`createManagementApiClient({baseUrl,
  token})`), where the ENGINE reads `PRISMA_SERVICE_TOKEN` from the
  injected `Runtime.env` for that token — the manager never exposes
  token material — so nothing has to hand a credential back out of
  the manager; no refresh machinery may exist for it; its error
  mapping happens at the call site (the static path has no error
  middleware). The auth commands that mutate state don't consume
  `ctx.api` as the pinned session afterwards (whoami enrichment
  runs in a fresh process).
- **The TokenStorage view**: bound to the workspace id, never to a
  credential snapshot — `getTokens` re-reads the file on every call
  and returns that workspace's current record. Write rules in §6.
  All SDK methods including the required `clearTokens` are
  implemented; the engine forwards the view and never calls it —
  no exceptions. The engine's own token read for `ctx.spawn`'s
  credential injection goes through the named operation
  `activeAccessToken()` (§11.5, the S3 amendment as re-ruled after
  the PR-136 review, 2026-08-11), so the rule stays absolute.
- Error unwrapping: the SDK's error middleware wraps non-SDK errors
  into `FetchError(cause)`; the engine's mapping walks the cause
  chain for BOTH `AuthError` and CLI structured errors, so
  manager-raised errors surface as themselves.
- Names never refresh (accepted, stated): reads are offline, so a
  renamed workspace keeps its stored name until the next login to
  it. `list` renders a nameless session by its id.
- Harness: `createTestCli` seeds `{sessions?, currentWorkspaceId?,
  credential?, environmentToken?}` over a mutable in-memory manager
  with full state read-back, plus the client config (local
  endpoint). `environmentToken` composes the env session and is
  exported to each run's env as `PRISMA_SERVICE_TOKEN`, which is
  where the engine reads it.

## 5. Fixtures and required tests

Fixture surface: client config injection (all four fields) pointed
at a local HTTP server scripting 401 → rotated pair → retry,
`invalid_grant`, 5xx/network-throw; a JWT minter (`sub`,
`workspace_id`, `exp`, `email` + an undecodable token); a
legacy-store builder (pointer valid/dangling/null/absent; one/many
entries; duplicate entries for one workspace; placeholder names;
entries without refresh tokens; corrupt context; wrong shape); a
deterministic clock; a way for a second process to hold the lock.

Required tests:
- process pinning: marker moved by a second process mid-run → the
  running process's requests still carry its pinned session's
  tokens; a NEW process picks up the new marker;
- pinned session ended by a second process → next request fails
  with session-ended wording (not the SDK's synthesized message,
  not the transient error);
- two refreshers on one session across two processes: both
  complete, the file ends with a valid pair (server-grace test via
  the scripted endpoint);
- refresh rotation: only token fields written; name and marker
  untouched; `expiresAt` re-derived; rotated pair persisted before
  the new access token reaches the caller;
- `endSession` vs in-flight rotation on the same session: the
  ended session stays gone (rotation must not resurrect it);
- login flow writes nothing through the manager (throwaway storage
  observed; manager file untouched until `createSession`);
- `createSession` holds no lock during the name fetch (a second
  process completes a mutation while the name request hangs);
- `createSession` claim/argument mismatch refusal;
- env session never refreshes (token endpoint not hit on 401);
- env-override matrix: every mutation × {unset, set, blank,
  whitespace} — error family asserted, state-file bytes unchanged;
  plus `endAllSessions` no-op success with zero stored sessions;
- end-current / sessions-held-none-current: one shared assertion
  over `ctx.session()`, the needs check, and a bare `ctx.api`
  touch;
- reads-never-write probe (filesystem spy: zero writes on every
  read path including migration adoption);
- token-material leak scan (seed a known secret; assert absent from
  stdout, stderr, debug logs, error meta, envelopes);
- lock: two concurrent mutations in different processes both land
  (no lost update); a crashed holder's lock is taken over after
  the stale threshold.

## 6. Runtime flows (normative)

**Unauthenticated.** `needs.credentials` →
`CLI.CREDENTIALS_REQUIRED` (exit 2, sign-in nextAction) before the
handler loads; bare `ctx.api` touch → same error at request time.
`whoami` → "signed out", exit 0. No auto-login.

**Sessions held, none current** (migration rows; end-current): same
code, distinct why ("you have workspace sessions but none is
current") with nextActions `auth workspace use` and login.

**Refresh.** Driven by the SDK on 401 through the bound
TokenStorage view; the exchange itself runs OUTSIDE the file lock
(§8) — only the resulting write takes it:
- `setTokens` (the rotation write): updates IN PLACE only `token`,
  `refreshToken`, `expiresAt` (the proactive token-endpoint adapter
  supplies the explicit OAuth lifetime; an SDK-driven rotation falls
  back to the access token's claim) of its workspace's record. NEVER
  creates
  a record, NEVER moves the marker, NEVER touches the name. If the
  freshly-read state has no record for that workspace (ended by
  another process), refuse and throw — no resurrection. If the new
  token's `workspace_id` claim disagrees with the bound id, refuse
  (refresh cannot re-scope). If the record's credential changed
  since the refresh started (a newer login), the write still lands
  — either pair is valid (§1); last write wins.
- `clearTokensIfCurrent`: remove the record iff its stored pair
  still exactly matches the pair that failed — exact over the
  SDK's three compared fields (`workspaceId`, `accessToken`,
  `refreshToken`). Clear the marker only if it names that record.
  This match is what makes a stale replay's `invalid_grant` benign
  when a newer pair is already stored — do not "simplify" it.
- `clearTokens` (required by the SDK's TokenStorage type; reached
  by its internal fallbacks): removes only the bound record — same
  slice as `clearTokensIfCurrent` without the match. It never
  means "end all sessions". The engine never calls `sdk.logout()`.
- `withRefreshLock` is implemented as IN-PROCESS single-flight
  only (the SDK requires the hook to lock at all; cross-process
  exchange races are server-absorbed, §1).
- Preemptive refresh stays PROHIBITED (per-request resolution
  keeps long runs current; a background refresher adds nothing).

**Refresh failure discrimination.** `AuthError.refreshTokenInvalid`
is `true` only for HTTP 4xx + body error exactly `invalid_grant`:
- `true` → the SDK has run compare-and-clear; if the session
  survived (newer pair stored), the retry proceeds — nothing
  surfaced. If it cleared, `CLI.CREDENTIALS_REQUIRED`, expiry
  wording; the ENGINE's mapping debug-logs endpoint status +
  error value (the SDK hands the manager no status — the manager
  debug-logs the clear attempt itself)
  BEFORE the clear.
- any other `AuthError` → the manager re-reads state FOR THE
  WORKSPACE THE CLIENT IS BOUND TO: record gone →
  `CLI.CREDENTIALS_REQUIRED`, session-ended wording; otherwise a
  transient auth-service error. A state check, never message
  parsing.
- any non-`AuthError` from the refresh path (e.g. the SDK's
  undecodable-token plain `Error`) → transient auth-service error;
  nothing cleared; debug valve records it.
- non-auth failures (network, 5xx) → transient; NOTHING cleared.
The SDK version is exact-pinned; a test asserts clearing happens on
`invalid_grant` and nothing else.

**Service token (env).** Composes as the process's pinned session
(`source: "environment"`), never stored, absent from `sessions()`
(the file's marked current stays shown; the listing states the
override). The ENGINE builds that session's client by reading
`PRISMA_SERVICE_TOKEN` from the injected `Runtime.env` itself: the
manager composes the session but never hands out the token.
Static-token client, no refresh; 401 → structured error
naming the env var; nothing cleared. `whoami` notes the override
when stored sessions exist. Blank/whitespace → the single
blank-token error.

**Debug valve.** `PRISMA_NEXT_DEBUG` shape: source won, resolved
state-file path, pin decision, refresh attempted, endpoint status +
error field, lock acquire/release/takeover. Token material NEVER
appears in any log, error, meta, or envelope.

## 6a. The commands

Legacy names, unchanged — the session model makes them honest
("log in to a workspace" = create a session for it):

- `auth login` — browser consent; user picks the workspace;
  `createSession(credential, workspaceId-from-claims)`.
- `auth logout` — `sessions()` for the count, then
  `endAllSessions()`; the command reports the count it ended.
- `auth whoami` — `ctx.session()`; identity for an ENV session
  comes from decoding the env token (read from `ctx.env`); a stored
  session's token is unreachable by construction (Session carries
  none, whoami has no manager), so its identity comes from `/v1/me`
  when online and offline whoami shows the workspace with no user.
- `auth workspace list` — `sessions()`, current marked, nameless
  rows rendered by id. Under an env override the listing states
  the env session is in force.
- `auth workspace use <ref>` — resolve against `sessions()`
  (command-side), `useSession(match)`.
- `auth workspace logout <ref>` — resolve, `endSession(match)`;
  prints the workspace it ended.

**RULED (operator, 2026-08-10): `workspace use` SELECTS among your
sessions; it never creates one.** No session for X → structured
error: "no session for workspace X — run `prisma auth login` and
pick X in the browser" (nextAction: the literal `prisma auth
login`). No browser ever opens from `use`; session creation belongs
to `auth login` alone. (Matches §1: the consent flow cannot target
a workspace. Both reviewers independently concurred.)

## 7. Migration from the legacy store

Governing rule: **the migration read writes nothing.**

| Legacy store state | Rule |
| --- | --- |
| Context file exists, pointer targets an existing entry | All entries adopted as sessions; that one current |
| Context exists, pointer dangles | All adopted; NO current |
| Context exists, `activeWorkspaceId: null` | All adopted; no current |
| No context, exactly one entry | Adopted, current |
| No context, multiple entries | All adopted; NO current (no coin flip) |
| Auth file missing / unparseable / wrong shape | No sessions. Never delete, never rewrite |

Adoption rules (identity-blind — entries from any account adopt):
- Key and pointer-resolve on the token's `workspace_id` claim (the
  legacy `credentialWorkspaceId`), not the hydrated display id.
- Entries whose token does not decode to a `workspace_id` are
  ignored (unkeyable).
- Duplicate legacy entries for one workspace: the LAST wins
  (matches legacy's latest-wins reads).
- Legacy placeholder names do not adopt: a name equal to
  "Unknown workspace" or to the workspace id adopts as undefined.
- Entries without a refresh token adopt (reads until expiry, then
  fail cleanly).
- `lastSeenAt` does not carry over; list order is store order.

Materialization: the adopted view is written into the new
single-file format on the first mutation, writing the FULL adopted
set. The adoption decision is re-made INSIDE the lock beside the
mutation's re-read: if a new-format state exists at that point it
wins outright and no adoption occurs (a naive full-set write could
resurrect tokens another process already rotated). The new format
lives at the SAME PATH as the legacy auth file (ruled 2026-08-10:
one file, one world), so the first v8 mutation rewrites it in the
new shape and a still-installed legacy CLI reads signed-out from
then on — a loud, `prisma auth login`-fixable state, preferred over
two silently diverging auth worlds. Until that first mutation the
file stays untouched and the legacy CLI keeps working. The context
sidecar is reaped by `endAllSessions`, which clears everything.
New writes use mode 0600 and tighten looser permissions on first
write. Env naming (ruled with the implementation):
`PRISMA_AUTH_FILE` names the state file; `PRISMA_COMPUTE_AUTH_FILE`
is the warned deprecated alias (`PRISMA_PLATFORM_AUTH_FILE` never
existed in the repo).

## 8. File, lock, and atomicity

- **One file**, shape normative: `{ version, sessions: [{
  workspaceId, name?, token, refreshToken?, expiresAt? }],
  currentWorkspaceId | null }`. No context sidecar. Every write
  replaces the whole state.
- **Writes are atomic**: temp file in the same directory, fsync,
  rename; mode 0600.
- **Reads never write; reads take no lock** (atomic rename
  guarantees a complete state).
- **One short advisory lock for read-modify-write.** Every
  mutation acquires it, re-reads, applies its slice, writes,
  releases. Its ONLY job is lost-update prevention between
  processes (two mutations touching different records must both
  land). **No network I/O ever runs under it** — the token
  exchange happens outside (§6), and `createSession`'s name fetch
  happens after release, with a second minimal locked write that
  sets `name` iff the record still exists. Holds are
  milliseconds, so: no heartbeat, a small fixed stale threshold
  (crashed-holder takeover), takeovers debug-logged. The rev-4
  heartbeat/exchange-timeout/steal apparatus existed to survive
  network calls under the lock; with none, it is deleted.
- **Slices** (each mutation re-reads under the lock and modifies
  only):

  | Mutation | May modify |
  | --- | --- |
  | `setTokens` (rotation) | token fields of its workspace's record |
  | `clearTokensIfCurrent` | removes its record (three-field match); marker only if it names it |
  | `clearTokens` | removes its record; marker only if it names it |
  | `useSession` | marker only |
  | `endSession` | one record; marker if it named it |
  | `createSession` | one record (upsert) + marker |
  | `createSession` name backfill | `name` of its record |
  | `endAllSessions` | whole state |

  No mutation writes state read before lock acquisition.
- **Rotation durability**: the rotated pair is persisted (fsync +
  rename) before the new access token reaches any caller.

## 9. Change surface on PR #130

Engine (`packages/cli-engine`) — a rename/reshape pass over the
landed a8ef3fb plus two behavior corrections in `api-client.ts`:
1. client construction returns to the engine (revert to the
   pre-a8ef3fb shape, then re-apply the §6 error mapping; config
   injection replaces the deleted `createSdk` seam). The run-long
   client memoization STAYS (process pinning makes it correct);
2. the failure mapping re-reads state for the BOUND workspace, not
   `currentSession()`.
Renames/reshapes: entity types per §2 (Identity/GrantSummary/
method axis deleted; Session is one-of-many with `current`); SPI
per §3 (`tokenStorage()` added; `apiClient`/`rememberWorkspaceName`
gone); error wording (sessions-held-none-current etc.); ref
resolution moves command-side (codes renamed to session
vocabulary); harness seeding per §4. The `managesCredentials`
capability and `defineCommand` overloads survive unchanged.

Auth module (`packages/cli/src/auth`): the manager implementation
(§7 migration, §8 file+lock, the TokenStorage views, process
pinning); `performLogin` returns the credential and uses a
throwaway storage; `fetchWorkspaceName` injected. Legacy operations
remain for the legacy shell until S2d.

v8 tree (`packages/cli/src/v8`): auth family onto the manager with
LEGACY names (`workspace-logout.ts` stays; no forget; `logout
--workspace` still does not return — superseded by `workspace
logout`). Command-side ref resolution.

Docs: parity-divergences auth sections rewritten — remaining
divergences: error-code map, exit unifications, whoami shape,
env-override mutation refusals (exact error family and exit code,
incl. the `auth logout` no-op rule), the list JSON shape when an
env session is in force, orphan-reaping logout, names no longer
refreshed on read. Amend s2a contract §3/§4/acceptance and S2
overview auth rows.

## 10. Disposition record

Rev 5 (2026-08-10): operator-designed session model. Operator
rulings: per-workspace sessions keyed by workspace id; identity
rule dropped (wallet identity-blind; reviewer-proposed
cross-account disclosure rules NOT adopted — "no different to
today"); legacy command names return; grants vocabulary dead;
`apiClient()`/`rememberWorkspaceName` off the SPI;
`createSession(credential, workspaceId)`; `useSession`/`endSession`
take `Session`; `workspace use` selects only; **process pinning** —
a process's session is fixed at first read, other processes'
switches never redirect it, and racing refreshes are accepted
(server-verified: 10s reuse grace + sibling-pair validity).

Delta review folded where the pinning ruling left it standing:
throwaway login storage (PE); `clearTokens` bounded to its record
(PE); name fetch outside the lock via injected
`fetchWorkspaceName` (architect + PE); env `endAllSessions` no-op
rule (PE); client config four-field list + env static-token
construction path + cause-chain unwrapping (PE); non-AuthError
refresh throw → transient (PE); migration additions: claim keying,
last-wins duplicates, placeholder names, refresh-token-less
entries, lock-held adoption decision (architect + PE); bound-
workspace failure mapping (architect); `Session` flattened to
`workspaceName` + uniform `current` (architect — VETO-ABLE
deviation 1); `tokenStorage(workspaceId)` as the seventh
engine-facing member (architect — VETO-ABLE deviation 2).

Made MOOT by process pinning (not adopted): sessionEpoch binding
and session-replaced errors; per-access client cache with
keys/eviction; call-chain-scoped lock re-entrancy (no nested
locking remains — `withRefreshLock` is in-process single-flight,
mutations take the short file lock directly); heartbeat/exchange-
timeout/stale ordering apparatus; cross-account race guards.

## 11. Revision 6 — the environment credential is not a session

Operator rulings, 2026-08-10, after review of the rev-5 implementation,
with the architect and principal-engineer passes on this delta folded
in. Rev 6 supersedes the parts of §§1–9 listed in §11.9; everything not
listed stands. NORMATIVE.

**The mistake rev 5 made.** It modelled the `PRISMA_SERVICE_TOKEN`
credential as a `Session`. It is not one, and forcing it into that
shape produced four defects that are all the same defect:

- `Session.source` existed to say "this one is not really a session";
- `current: true` was hardcoded on it, because it has no marker to
  compare itself against — so `current` meant "the file's marker names
  this" in `sessions()` and "this is what the process acts as" in
  `currentSession()`;
- `workspaceId: ""` was written when the token's claims did not name a
  workspace, because a non-session was forced to carry a session's key;
- `useSession`/`endSession` needed a guard rejecting an environment
  session, because it was shaped like a stored one.

None of them needs fixing separately. They stop existing.

### 11.1 The three things, separated

**A session** is a stored logged-in-ness for one workspace. It is the
only thing called a session: what `sessions()` lists, what
`selectSession` selects, what `endSession` ends.

```ts
interface Session {
  readonly workspaceId: string;
  readonly workspaceName: string | undefined;
  /** The STORED ACCESS TOKEN's expiry, which rotation changes. Not a
   *  deadline on the logged-in-ness. */
  readonly expiresAt: Date | undefined;
}
```

**The selection** is one scalar of stored state — the workspace whose
session is used where a session is needed. Absent means none selected.
It is read directly, never inferred from a flag on each element. One
read returns both, because reads take no lock (§8) and two reads could
straddle a write:

```ts
interface StoredSessions {
  readonly sessions: readonly Session[];
  readonly selectedWorkspaceId: string | undefined;
}
```

Invariant, enforced by the manager: `selectedWorkspaceId` either names
one of the listed sessions or is absent. A dangling selection never
escapes the manager, so no consumer handles that case.

**The active credential** is what this process authenticates as. The
command-visible shape carries no token material:

```ts
interface ActiveCredential {
  /** Absent when nothing names it — an environment token whose claims
   *  carry no workspace. Never the empty string. */
  readonly workspaceId: string | undefined;
  readonly workspaceName: string | undefined;
  readonly expiresAt: Date | undefined;
  /** Decoded from the credential's own claims by the manager, so no
   *  command ever holds a token to decode. */
  readonly identity: CredentialIdentity | undefined;
  readonly origin: CredentialOrigin;
}

interface CredentialOrigin {
  /** Exists to be PRINTED — it feeds whoami's `source` field verbatim.
   *  Outside whoami's renderer and the credential-rejected error
   *  constructor, comparing against it is a defect. */
  readonly source: "stored" | "environment";
}
```

`CredentialOrigin` says where the credential came from. That is a real
question about the resolution — unlike rev 5's `Session.source`, which
asked it of the session. It carries no prose and no next actions: the
manager never talks to the user (§3). Where wording must differ by
origin, the difference lives in ONE error constructor in
`credential-errors.ts`, which is where wording already lives.

Absence is `undefined` in every in-memory shape. `null` survives only
in the on-disk JSON.

**Vocabulary, ruled.** One word per concept. In code the word is
SELECTED: `selectedWorkspaceId`, `selectSession(workspaceId)`, and the
reason `sessions-held-none-selected`. Two things deliberately keep
"current" and are not to be renamed: the on-disk field
`currentWorkspaceId` (no migration for a rename), and the user-facing
surface — the command `auth workspace use` and `auth workspace list`'s
`context.currentWorkspaceId` and per-item `current`, all of which are
contracts. `ctx.session()` becomes `ctx.activeCredential()`; leaving it
named `session` reproduces the mistake one layer out.

### 11.2 Refresh follows the credential, not its origin

A credential refreshes if it has a refresh token. Where it came from is
irrelevant. Nothing hard-codes "environment means never refresh". The
engine builds one client, always the refreshing one, over the storage
the manager hands it. `ClientBinding` goes entirely — not just its
`source` field — along with the static-path 401 inspection, because the
mapping asks the manager for the active credential rather than
remembering a binding of its own.

**Why the uniform path, when no credential source exercises it today.**
A single environment variable supplies one bearer string, so an
environment credential cannot currently carry a refresh token and the
memory-backed rotation is unreachable in practice. The uniform path
exists to delete a construction branch, not to serve a future feature.
Do not "clean it up" as dead code.

**Which storage, chosen once.** The choice is made when the pin
resolves, and each storage has exactly one source of truth. The
conditional is in which storage is constructed, never inside one that
checks at write time whether it has a home.

- **File-backed**, for a credential with a home record. Unchanged from
  §4: `getTokens` re-reads the file on EVERY call; writes take the
  short lock. No memory layer may sit in front. That read-through is
  what lets the SDK recover when another process has already rotated —
  this process sees the newer pair, skips the exchange, and retries. A
  cache would spend a refresh token another process already used and
  end in a spurious "sign in again" while the file holds a working
  pair.
- **Memory-backed**, for a credential with no home record. Reads and
  writes are process memory; nothing survives the process. It closes
  over a local variable, is never given the state file's path, and
  touches no file on any method — including `clearTokens`, which the
  SDK calls when `clearTokensIfCurrent` is absent. An environment
  credential whose workspace matches a stored session must not be able
  to delete that session.

The SDK's `Tokens` requires `workspaceId: string`. The memory-backed
storage supplies the claim when the credential has one and a fixed,
obviously-not-a-workspace constant when it does not. That value never
leaves the manager and is never the empty string.

**A 401 that could never be renewed.** This is the path that actually
runs today. The SDK raises `AuthError("No refresh token available")`
with `refreshTokenInvalid` false, never touching the token endpoint.
It must NOT fall through to the session-ended mapping, which is untrue
and whose remedies do not apply, nor to the transient one, which tells
a CI job to retry a permanent failure forever. The engine discriminates
by state, never by message: after the failure it asks the storage for
the tokens, and a set with no refresh token could never have been
renewed. The result is one credential-rejected error whose wording
follows `origin.source` — for an environment credential that reproduces
today's `AUTH.SERVICE_TOKEN_REJECTED` naming the variable.

This also repairs a rev-5 defect: §7 adopts legacy entries with no
refresh token and says they "fail cleanly at expiry". They do not —
they reach the same line and surface as a transient error advising a
retry. One fix covers both.

**Known limit.** Real service tokens name their workspace through a
`sub: "workspace:<id>"` claim rather than `workspace_id`. If they ever
gain refresh tokens, the SDK's own workspace extraction would throw on
the rotated token.

### 11.3 What the pin holds

Rev 5's pin is a workspace id re-resolved against the file on every
read. Rev 6 pins THE DECISION — which credential, and from where — at
first read, and keeps reading the material through the storage on every
call. Nothing pins a token value. A session ended by another process
mid-run therefore still fails with the session-ended wording, and a
session replaced by another process still recovers through the SDK's
re-read.

### 11.4 Custody, restated

§4's "the manager never exposes token material" means **never to
commands**. The engine may hold credentials — it must, to authenticate.
The manager hands the engine what it needs through
`activeCredentialStorage()`; `ActiveCredential` and `Session` still
carry no token, which is the property the rule protects. The rev-5
wording, read as absolute, is what forced the engine to reach around
the manager into `Runtime.env`.

### 11.5 The interface

```ts
activeCredential(): Promise<ActiveCredential | null>;
sessions(): Promise<StoredSessions>;
createSession(credential: Credential, workspaceId: string): Promise<Session>;
selectSession(workspaceId: string): Promise<Session>;
endSession(workspaceId: string): Promise<void>;
endAllSessions(): Promise<void>;
/** ENGINE-FACING. Zero-argument: process pinning already ruled there
 *  is one credential per process, and an environment credential may
 *  have no workspace id to key on. Only valid once activeCredential()
 *  has returned non-null; the engine resolves that first. */
activeCredentialStorage(): Promise<TokenStorage>;
/** ENGINE-FACING (S3). The active credential's ACCESS token, read
 *  fresh on every call, for handing to a child process. With options,
 *  refreshes or refuses a token that lacks the required remaining
 *  lifetime. Never the refresh token. */
activeAccessToken(
  options?: ActiveAccessTokenOptions,
): Promise<string | null>;
```

All three mutations are workspace-id-keyed, symmetric with
`createSession`. `selectSession` returns the selected `Session`, which
`auth workspace use` renders. `tokenStorage(workspaceId)` is deleted
rather than reshaped: nothing needs storage for a workspace other than
the active one, and the parameter implies an axis of variation the
system does not have.

S3 amendment (2026-08-11, re-ruled after the PR-136 architect review):
the engine forwards the storage `activeCredentialStorage()` returns
into SDK client config and never calls its methods itself — no
exceptions. What the spawn path needs is a manager OPERATION, not a
carve-out: the interface gains `activeAccessToken()`, consumed by the
delegated-credential preflight and by `ctx.spawn`'s credential injection
in the engine's spawn module (`packages/cli-engine/src/execution/spawn.ts`,
`spawnToken`). It is read at spawn time and handed to the child as
`PRISMA_SERVICE_TOKEN` (+ `PRISMA_WORKSPACE_ID` when the credential
names a workspace; when it names none, an inherited
`PRISMA_WORKSPACE_ID` is DELETED from the child environment — the two
variables are one protocol, written as a unit). The injected token is
a snapshot; the child never refreshes; the refresh token is never
injected. The read builds no second API client, so the
one-client-per-process invariant of this design HOLDS: the engine's
pinned refreshing client remains the only client ever constructed in
the process (composer's in-process leg is authenticated by injecting
that same `ctx.api` through its `deps.client` seam, not by composing
another client from env). For an environment-only manager the
operation is a pass-through of the env token — no storage involved.

S3 amendment (2026-08-14): the child still receives only an access-token
snapshot, but a stored OAuth session is no longer rejected merely because
that snapshot is inside the five-minute window. Before the handler runs, the
engine asks `activeAccessToken(options)` to refresh the pair under the
manager's storage lock, persist the rotation, and return the new access token.
The shipped manager receives a host-side token-endpoint adapter at construction;
the manager remains the sole owner of storage reads and writes, and the
refresh token is never added to child env. The spawn-time call is another
validated fresh read, so rotation by another process between preflight and
spawn is still observed without handing the child an unchecked replacement.

### 11.6 whoami

`whoami` asks for the active credential's identity and renders it. It
does not branch on origin and decodes nothing itself. `/v1/me` remains
an online enrichment and WINS where it disagrees with the claims; the
claims are the offline fallback. There is one identity type,
`CredentialIdentity`, for both the claimed and the fetched identity —
the command's own `SessionIdentity` is deleted.

With no workspace, `whoami` omits the workspace row and its JSON
`workspace` is `null`. It never prints an empty string or `undefined`.

### 11.7 Mutations while an environment credential is in force

**RULED: the refusals go.** Rev 5 refused `useSession` and
`endSession`, and refused `endAllSessions` unless the store was empty,
while `PRISMA_SERVICE_TOKEN` was set. That rule existed because the
environment thing was a session occupying the current slot. It is not
one. Selecting or ending a stored session while an environment
credential is in force is coherent: it changes stored state, and this
process keeps authenticating as the environment credential.

All three now succeed, each printing the one-line notice `createSession`
already prints — that the environment credential remains in force until
the variable is unset. The `endAllSessions` CI carve-out disappears
with the rule it worked around: it simply clears the store.

### 11.8 Removal is idempotent

`endSession` on a workspace with no session succeeds: the postcondition
is identical either way. The useful error — a workspace reference the
user never had — is raised earlier and command-side, when the ref fails
to resolve against `sessions()`, so `AUTH.NO_SESSION_FOR_WORKSPACE`
still reaches a user who mistypes. What changes is only the race: a
session removed by another process mid-command now exits 0 rather than
exit 2 with an untrue message.

`selectSession` is NOT idempotent and still refuses a workspace with no
session: there is no state in which it would afterwards be selected.

### 11.9 Superseded

- §1: "No refresh, never stored" — reword as a fact about the token
  shape, not a rule: it carries no refresh token, so nothing rotates.
- §2: `Session.source` and `Session.current`; "the marker is called
  CURRENT everywhere"; "whoami decodes the current session's claims".
- §3: `currentSession()`; the `sessions()` return type;
  `useSession`/`endSession` taking a `Session`; the environment-session
  misuse error; ALL the env-override mutation refusals (§11.7).
- §4: `ctx.session()`; `tokenStorage(workspaceId)`; the env
  static-token construction path and the engine reading
  `PRISMA_SERVICE_TOKEN` itself; "ONE stored-session API client" loses
  its qualifier; refresh writes are keyed by the credential's home
  record, when it has one; the harness `currentWorkspaceId` and
  `environmentToken` seed shapes.
- §5: "env session never refreshes" — the premise becomes "it has no
  refresh token"; the env-override matrix follows §11.7; the
  `ctx.session()` shared assertion is renamed.
- §6: "no refresh machinery may exist for it"; the service-token 401
  path; the `sessions-held-none-current` reason name.
- §6a: the whoami identity split.
- §9: describes rev-5 work; history, not instruction.

Unchanged: the migration (§7), the file, lock and atomicity rules (§8),
and process pinning itself as narrowed by §11.3.

### 11.10 Tests this delta requires

1. Environment credential with no refresh token: 401, token endpoint
   not hit, the credential-rejected error naming `PRISMA_SERVICE_TOKEN`.
2. Environment credential WITH a refresh token: 401, rotation, retry
   succeeds, state file bytes unchanged, a second request in the same
   process carries the rotated token.
3. Environment credential whose workspace matches a stored session,
   refresh answers `invalid_grant`: the stored session survives and the
   file is byte-unchanged.
4. Stored session with no refresh token (§7's migration case): the
   error says sign in again, not retry.
5. Cross-process rotation recovery: B rotates, A gets a 401, A's
   re-read sees B's newer pair and retries without hitting the token
   endpoint.
6. `endSession` on a workspace with no session writes nothing and
   exits 0; `auth workspace logout X` where another process removed X
   mid-command exits 0.
7. `activeCredential()` with a claimless environment token:
   `workspaceId` is `undefined`, and neither the human card nor the
   JSON renders an empty string or `undefined`.
8. Every mutation succeeds while `PRISMA_SERVICE_TOKEN` is set, each
   printing the in-force notice (§11.7).
