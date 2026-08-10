# Credential manager — design, revision 3 (normative)

Status: operator-adopted (2026-08-10). Revision 2 folded in the
pre-implementation design review (architect + principal engineer);
revision 3 adopts the GRANTS model by operator ruling: user-facing
workspace functionality is kept — "We have a credential manager now
literally to support managing multiple credentials for access to
different workspaces." NORMATIVE for the implementation, which lands
on PR #130. A delta re-review (both reviewers) covers rev2→rev3.
Prior revisions are in git history.

## 1. Why this exists

The engine gave commands two auth surfaces — `ctx.api` (consume the
management API) and `ctx.getCredentials` (read the resolved
credential) — and no modeled surface for the thing auth commands
operate ON: the credential machinery. The S2a auth-family port
therefore imported around the engine. The defect being corrected is
the ONTOLOGY and the PLUMBING, not credential plurality: the legacy
model had no active-identity concept (per-workspace "sessions" with
login/logout verbs — identity conflated with credential scope), a
split-brain context sidecar, read paths that write, and commands
bypassing the engine. Control-plane facts (operator-validated): user
OAuth tokens are workspace-bound at consent; refresh cannot
re-scope; the platform's multi-workspace primitive (`ActorUser`)
serves Console but not OAuth tokens today, and the platform is not
changing now — so multi-workspace access REQUIRES holding multiple
workspace-bound credentials. The 17-tool survey found no precedent
for exposing that plurality as per-workspace sessions; this design
KNOWINGLY keeps the plurality (operator ruling: functionality is not
dropped) while fixing the ontology: one identity, grants as
authorization artifacts, scalar view to every consumer.

## 2. Ruled outcomes

R1 The engine models the machinery as the **credential manager**
   (user-centric surface over what is a dumb store today).
R2 Auth state: ONE identity, PLURAL workspace grants, ONE active
   grant. The active-grant cursor is session state (satisfying the
   draft premise: workspace selection is session state, not a
   credential). Toward every engine consumer the view is SCALAR —
   `session()`/`credential()`/`ctx.api`/`needs.credentials` see only
   the active grant. The plurality lives entirely inside the
   manager. No per-workspace login/logout vocabulary anywhere: you
   log in as yourself; you hold, select, and forget GRANTS.
R3 Tree: `auth login`, `auth logout`, `auth whoami`,
   `auth workspace list` (your held grants), `auth workspace use`
   (activate a held grant, or acquire one via the consent flow when
   not held), `auth workspace forget <ref>` (drop one grant —
   replaces the legacy `auth workspace logout`; nothing is a
   per-workspace "logout"). `auth logout --workspace` does not
   return (superseded by `forget`). Divergence entries accompany
   every rename/semantic change.
R4 Migration from the legacy store per the decision table in §7.
R5 The fix lands on PR #130 (the shipped registry port is reworked,
   not merged as-is).

## 3. Entities

No conditional properties (standing ruling): absent = `T | undefined`,
required key. All claim-derivable fields are derived by the manager,
never caller-supplied.

```ts
type Identity =
  | { readonly kind: "user"; readonly id: string; readonly email: string | undefined }
  | { readonly kind: "service"; readonly id: string | undefined; readonly label: string | undefined };

interface Credential {
  readonly token: string;
  readonly refreshToken: string | undefined;
  readonly expiresAt: Date | undefined;
  readonly method: "user-oauth" | "service-token";
}

interface Workspace {           // resolved pair; NOT the id-or-name
  readonly id: string;          // string users type (that concept is
  readonly name: string | undefined; // called a ref elsewhere)
}

interface Session {
  readonly identity: Identity;
  readonly method: "user-oauth" | "service-token";
  readonly origin: "stored" | "environment";
  readonly workspace: Workspace;      // the ACTIVE grant's workspace
  readonly expiresAt: Date | undefined;
}

interface GrantSummary {              // user-centric listing; NEVER
  readonly workspace: Workspace;      // carries credential material
  readonly expiresAt: Date | undefined;
  readonly active: boolean;           // cursor position; when an env
}                                     // token overrides, the LISTING
                                      // command must say the env
                                      // session is what's in force
```

A GRANT is the pairing of a workspace with the credential the user's
consent minted for it. The manager stores grants internally
(credential material included); everything it EXPOSES about the set
is `GrantSummary` — token material structurally cannot leave.

Notes (review-settled):
- `Session.origin` is the field that justifies the Session/Credential
  split: it drives `endSession`'s refusal and lets `whoami` explain an
  env override. `method` is a different axis (how authenticated) from
  `identity.kind` (who) — perfectly correlated today, genuinely
  distinct, will diverge (e.g. a personal access token).
- There is no `Scope` entity (dissolved in review: the one-element
  array served neither timeline, and the word collides with OAuth's
  `scope` claim). Future `ActorUser` routing adds
  `reachable: readonly Workspace[]` beside `workspace` — additive.
- `Session` corresponds closely to the platform's own "principal"
  (`/v1/me`: credential + user + workspace). The user-centric name
  Session is deliberate (operator ruling); this note is the bridge
  for readers of both codebases.
- Identity/workspace/expiry are decoded from JWT claims by the
  manager (claims only — see §4 boundaries). `name` on Workspace is
  `undefined` unless an explicit write recorded it; there is no
  read-path caching.

## 4. The CredentialManager interface

```ts
interface CredentialManager {
  /** User-centric truth. Local-only: composes env + stored state,
   *  decodes claims, NEVER touches the network. An env service token
   *  wins over a stored credential; when both exist, the Session is
   *  the env one (origin: "environment") and whoami is responsible
   *  for surfacing the override (§6). */
  session(): Promise<Session | null>;

  /** Login's write. Derives identity, workspace, and expiry from
   *  the credential's claims (single-argument by review ruling).
   *  Same identity as the held grants: UPSERTS the grant for that
   *  workspace and makes it ACTIVE; other grants untouched.
   *  DIFFERENT identity: all existing grants are discarded and
   *  replaced by this one — the one-identity invariant is enforced
   *  here, and the stored state carries the identity ONCE beside
   *  the grants array so the invariant is structural. */
  beginSession(credential: Credential): Promise<Session>;

  /** Logout, whole-identity. Local (does not revoke server-side;
   *  other processes' in-memory access tokens stay valid until
   *  expiry — user-facing text says so). Clears ALL grants and the
   *  cursor (also reaps legacy orphan entries, §7). Rejects with a
   *  structured error when the active session is env-supplied; the
   *  error's why states whether stored grants also exist. */
  endSession(): Promise<void>;

  /** The held grants, as summaries (no credential material).
   *  Local-only like session(): never touches the network. */
  grants(): Promise<readonly GrantSummary[]>;

  /** Records a human-readable workspace name learned by a command
   *  (e.g. from the consent flow or an API response). The sanctioned
   *  name-write path — beginSession stays single-argument and
   *  claims-only. Explicit write; never a read-path side effect. */
  rememberWorkspaceName(workspaceId: string, name: string): Promise<void>;

  /** Move the cursor to a HELD grant. Ref resolution is the
   *  manager's, against held grants only: exact id first, then
   *  case-insensitive name; ambiguity is a structured error;
   *  no match is a structured error the COMMAND catches to run the
   *  consent flow + beginSession (the manager never interacts with
   *  the user). Activating an expired grant succeeds locally (no
   *  network check) and fails at first use — grants() exposes
   *  expiresAt so commands can warn. */
  activateGrant(ref: string): Promise<Session>;

  /** Drop one grant. If it was active, the cursor clears (no
   *  auto-promotion of another grant). */
  forgetGrant(ref: string): Promise<void>;

  /** The consumer path. Resolves the credential that authorizes a
   *  request NOW; refresh happens inside (§6). Invariant:
   *  credential() === null  ⟺  session() === null. */
  credential(): Promise<Credential | null>;

  /** The authenticated management API client, constructed and owned
   *  by the MANAGER (review blockers: the engine must not build a
   *  half-configured SDK — the real clientId lives with the auth
   *  module — and no SDK type may appear on this interface beyond
   *  the engine's existing ManagementApiClient alias). One client,
   *  one in-process refresh single-flight. */
  apiClient(): Promise<ManagementApiClient>;
}
```

Mutation rule under an env override (uniform): while a
`PRISMA_SERVICE_TOKEN` session is in force, EVERY manager mutation —
`endSession`, `activateGrant`, `forgetGrant`, `beginSession` — refuses
with the same structured error family (why names the env var and
states whether stored grants exist underneath). Stored state is never
mutated while the user cannot observe it as their session. Reads
(`session()`, `grants()`, `credential()`) work normally.

State effects, at a glance:

| Verb | Effect |
| --- | --- |
| `beginSession` | upsert one grant (same identity) or replace all (new identity); set cursor |
| `activateGrant` | cursor only |
| `forgetGrant` | remove one grant; clear cursor if it was active |
| `endSession` | remove ALL grants and cursor |

(The single-workspace inverse of `beginSession` is `forgetGrant`,
not `endSession`.)

Boundaries (review-settled):
- **Custody, not user interaction**: the manager never opens a
  browser, never prompts, never talks to the user. (It DOES mint in
  the narrow senses of refresh and future exchange — the earlier
  "never creates" phrasing was wrong.) The login FLOW lives beside
  it: `performLogin` changes shape to RETURN the minted credential
  (today it persists internally and returns void); the login command
  hands that credential to `beginSession`.
- **Claims only, never network**: `session()` on every command's
  context (see §5) must be safe to call anywhere; enrichment (user
  display name, workspace name) is `whoami`'s job through `ctx.api`.
- **Env is a construction input**: the manager receives `env` at
  construction (like today's `makeGetCredentials(env)`); no library
  below it may read `process.env` (this retires the
  `PRISMA_PLATFORM_AUTH_FILE`-vs-`PRISMA_COMPUTE_AUTH_FILE`
  split-brain: exactly one variable names the auth file, resolved
  from the injected env; the other is accepted as a deprecated alias
  with a one-time warning and never wins over an explicit path).
- **Error raising is single-sourced**: set-but-blank service token →
  one structured error (the existing AUTH.CONFIG_INVALID content)
  raised identically from `session()`, `credential()`, and the needs
  check; unreadable store (EACCES/EPERM) → `CLI.CREDENTIALS_UNREADABLE`;
  parse-corrupt store → signed out (self-heals on next login), never
  an exception, never a write.

## 5. Engine integration

- `Runtime.credentialManager: CredentialManager` REPLACES
  `Runtime.getCredentials`, staged (review ruling — not atomic):
  1. add `credentialManager` optional; engine prefers it, falls back;
     bin wires the real manager; harness gains seeding;
  2. move the needs check + `ctx.api` onto the manager; rework the
     auth family;
  3. delete `getCredentials` and fix remaining Runtime literals in
     one mechanical commit.
- `ctx.session(): Promise<Session | null>` appears on EVERY context
  (read-only, local-only — tested to perform no network I/O).
- `ctx.getCredentials` is DELETED (no handler consumes it; the
  context ends with fewer auth surfaces than before: `api` +
  `session`).
- Manager access is a CAPABILITY, not a need (a declaration never
  fails a run): `managesCredentials: true` on the command definition
  puts `ctx.credentialManager` on the context. Declared by exactly:
  `auth login`, `auth logout`, `auth workspace list`, `auth
  workspace use`, `auth workspace forget`. `whoami` uses
  `ctx.session()` only. `grants()` lives ONLY on the manager — never
  on the universal context (the plural view stays contained). The
  doc is honest that this is documentation + testability, not
  enforcement.
- `ctx.api` becomes a thin lazy proxy over `manager.apiClient()`
  plus the engine-side error mapping (§6). The engine's placeholder
  OAuth constants and its SDK construction are deleted.
- Harness: `createTestCli({ credential?: Credential; session?: Session })`
  seeds a MUTABLE in-memory manager readable back by tests (login/
  logout tests observe state changes). Prefer seeding `credential`
  and letting real derivation run; `session` is the escape hatch.
  Additional fixture surface (review-required): an injectable
  refresh/token endpoint so tests script 401 → rotated pair → retry
  (asserting rotated-refresh persistence), `invalid_grant`
  (asserting clear + expiry wording), 500/network-throw (asserting
  credential UNTOUCHED and error is NOT credentials-required), plus
  one real-filesystem two-process lock test (spawn two node
  processes, both refresh, exactly one token exchange survives).
- Draft amendments land with the implementation: §4 (context:
  session, api; getCredentials gone), §6 (`managesCredentials`), §10
  (`Runtime.credentialManager`), §11 (harness seeding + fixtures).

## 6. Runtime flows (normative)

**Unauthenticated.** `needs.credentials` → engine fails early with
`CLI.CREDENTIALS_REQUIRED` (exit 2, sign-in nextAction), handler
never loads. Bare `ctx.api` touch → the same error (single
constructor) at request time. `whoami` → completes "signed out",
exit 0. No auto-login (standing Q1 default).

**Grants held, none active** (migration rows; forget-active): same
code `CLI.CREDENTIALS_REQUIRED`, distinct why ("you hold grants but
none is active") and nextAction `auth workspace use` alongside
sign-in. Single-sourced like the other credential errors: session(),
credential(), and the needs check produce it identically. NOTHING
auto-promotes a grant.

**Refresh.** Driven by the SDK on 401, with the manager as its
`TokenStorage` — the storage view the SDK sees is bound to THE GRANT
the client was constructed for (not the cursor: a concurrent
`workspace use` must not redirect a refresh mid-flight), under the
mandatory lock (§8). The manager MUST implement `withRefreshLock`
(the SDK silently skips locking without it) and
`clearTokensIfCurrent` scoped to that grant: remove it if and only
if its STORED credential still exactly matches the one that failed;
clear the cursor only if that grant is still the active one. Blast
radius of a definitive refresh failure: one workspace, never the
identity. Preemptive refresh is PROHIBITED (a second refresher outside
the SDK's single-flight can spend a rotated refresh token and
convert an optimization into a false sign-out). Per-request token
resolution keeps long runs current.

**Refresh failure discrimination.** The SDK's
`AuthError.refreshTokenInvalid` is `true` ONLY for HTTP 4xx with
body error exactly `invalid_grant` — the reliable definitive
trigger. Engine-side mapping (replaces today's map-every-AuthError):
- `refreshTokenInvalid === true` → `CLI.CREDENTIALS_REQUIRED`,
  expiry wording ("your session has expired — sign in again"). The
  SDK has already cleared (compare-and-clear); the manager logs the
  token-endpoint status + error value at debug level BEFORE the
  clear so support can distinguish real expiry from a server bug.
- No credential at all → `CLI.CREDENTIALS_REQUIRED`, unauthenticated
  wording — raised by the manager's own structured error, not the
  SDK's synthesized message.
- Any other auth failure (network, 5xx, other 4xx) → a transient
  auth-service error, surfaced as such. NOT credentials-required.
  NOTHING cleared.
The sign-out decision is thereby the SDK's policy; the SDK version
is exact-pinned and a test asserts clearing happens on
`invalid_grant` and on nothing else.

**Service token (env).** No refresh. 401 → structured error naming
`PRISMA_SERVICE_TOKEN` with a Console-pointing fix; nothing cleared.
Unset → fall through to stored; set-but-blank or whitespace → the
single blank-token error (§4). `session()` reports the env session
(origin "environment"); when a stored session ALSO exists, `whoami`
surfaces a one-line note that the env var is overriding it.

**Lock contention.** A refresh-lock wait timeout is NOT an engine
bug: it gets its own structured code, a why naming the lock path
("another prisma process may be refreshing"), and a next action.

**Debug valve.** Same shape as the telemetry sender's
(`PRISMA_NEXT_DEBUG`): prints source won (env/stored), resolved auth
file path, refresh attempted, token-endpoint status + error field,
lock acquire/release/steal with holder ids. Token material (access,
refresh, JWTs, even truncated) NEVER appears in any log, error
message, meta, or envelope — the session read model structurally
cannot carry it.

## 6a. Switching grants

`auth workspace use <ref>` is the switch: it activates a held grant
(cursor move, §4), or — when no grant matches — announces in one line
that it is opening the browser to authorize that workspace, runs the
consent flow, and hands the minted credential to `beginSession`. Run
fully signed out, `use` is effectively a full login and announces
itself as such. `auth login` is for signing in (first grant) or
changing identity. To/from a service token: set/unset the env var
(wins at read time; also the scripts/parallel-terminal override).
Known trade-off (accepted): the ACTIVE cursor is one shared piece of
state on disk, so two terminals share it; simultaneous work against
two workspaces uses a service token in one terminal. A per-process
workspace override selecting among held grants without moving the
cursor is a recognized future affordance — explicitly deferred, not
designed here.

## 7. Migration from the legacy store (R4)

Governing rule: **the migration read writes nothing.** The store is
mutated only by `beginSession`, `endSession`, and refresh.

| Legacy store state | Rule |
| --- | --- |
| Context file exists, pointer targets an existing entry | All entries adopted as grants; that one is active |
| Context exists, pointer dangles | All entries adopted as grants; NO active grant (commands needing credentials fail with a why suggesting `auth workspace use` or login) |
| Context exists, `activeWorkspaceId: null` | Grants adopted; no active (legacy's explicit signed-out-of-active state preserved) |
| No context, exactly one entry | Adopted as the single grant, active |
| No context, multiple entries | All adopted as grants; NO active (no coin-flip; the user activates or logs in) |
| Auth file missing / unparseable / wrong shape | No grants. Never delete, never rewrite |

The migration read writes nothing; the adopted view is materialized
into the NEW single-file format only on the first mutation
(beginSession / activateGrant / forgetGrant / endSession / refresh
rotation), and materialization writes the FULL adopted set, not only
the mutated grant. Once the new file exists, the legacy files are
ignored entirely (a legacy CLI writing after materialization is
invisible to v8 — accepted). Until then the legacy files stay
untouched, so a still-installed legacy CLI keeps working.
`endSession` clears everything including legacy files. New writes
use mode 0600 and tighten looser existing permissions on first
write. Mixed-identity legacy entries: adoption applies the
one-identity rule — see the beginSession invariant; the PE delta
review's rule is folded in §7 when it lands.

## 8. Locking and atomicity contract

- **One file** holds the whole credential state (the grants array +
  the active cursor + metadata). No context sidecar — the
  split-brain class dies by construction. Every write replaces the
  whole state, so grants and cursor can never disagree.
- **One env var** names the auth file, resolved from injected env
  (§4); the legacy second variable is a warned, deprecated alias.
- **Writes are atomic**: temp file in the same directory, fsync,
  rename; mode 0600; whole-state replacement only.
- **Reads never write** (migration adoption is a pure read; the
  legacy read-path-write bug class must not recur). Self-cleaning on
  `invalid_grant` is a STATE TRANSITION (a write path), permitted;
  opportunistic caching writes on reads are not.
- **Reads take no lock** (safe via atomic rename: old or new
  complete state, never partial).
- **One advisory lock, every mutation**: `beginSession`,
  `endSession`, refresh all serialize on the same lock file.
  `withRefreshLock` is implemented (mandatory), so the SDK's refresh
  runs under it.
- **Re-entrant within a process** via a held owner token (a nested
  acquire is a no-op). No per-call-site "don't lock" flags — the
  legacy `lockSetTokens: false` mechanism does not survive.
- **Heartbeated**: holder touches the lock every ~5s; stale
  threshold ≥ 4× heartbeat; the token-exchange HTTP call carries a
  hard timeout below the stale threshold (a live refresh can never
  look stale); lock file records pid/hostname/start; steals are
  debug-logged with both identities.
- **Every mutation re-reads under the lock**; refresh compares
  against the credential that failed (the SDK does this given the
  lock); `clearTokensIfCurrent` clears only on exact match.
- **Rotation durability**: the rotated pair is persisted (fsync +
  rename) before the new access token is handed to any caller. The
  unclosable client-side window (process killed between server
  rotation and rename) is accepted; recovery is `prisma auth login`.

## 9. Change surface on PR #130 (checklist)

Engine (`packages/cli-engine`): Runtime staged swap (§5);
`ctx.session`; delete `ctx.getCredentials`; `managesCredentials`
capability; api-client.ts reduced to lazy proxy + §6 error mapping
(delete SDK construction + placeholder constants); draft amendments
(§4/§6/§10/§11); harness seeding + fixture surface; type-tests.

Auth module (`packages/cli/src/auth`): the manager implementation
(persistence per §8, migration per §7, SDK construction with the
real CLIENT_ID, refresh integration); `performLogin` returns the
credential; the workspace OPERATIONS (`listAuthWorkspaces`,
`switchAuthWorkspace`, `logoutAuthWorkspace`) REMAIN — the legacy
shell consumes them until S2d; only their v8 exposure goes.

v8 tree (`packages/cli/src/v8`): REWORK (not delete) the workspace
commands onto the manager: `workspace-list.ts` presents `grants()`
(help text says held grants, not memberships); `workspace-use.ts`
tries `activateGrant(ref)` and on grant-not-held runs the consent
flow then `beginSession`; `workspace-logout.ts` becomes
`workspace-forget.ts` (`auth workspace forget`, `forgetGrant`);
`logout.ts` drops `--workspace` (superseded). `login`/`logout` move
onto `ctx.credentialManager`; `whoami` onto `ctx.session()` +
`ctx.api` enrichment (and may show held-grant count). Runtime wiring
supplies the manager. The legacy operations in `src/auth` still
serve the legacy shell until S2d.

Docs: rewrite (not append) the auth sections of
`assets/s2/parity-divergences.md` (subgroup reworked and renamed —
`workspace logout` → `workspace forget` is itself a divergence;
whoami json shape change — the legacy `provider` field has no
successor, held-grant count added; orphan-reaping logout; error-code
notes); amend `specs/s2a-foundations.md` §3/§4/acceptance (six
commands, manager exports, erratum note); S2 overview auth rows.

## 10. Review disposition record

Rev 2: both reviews accept-with-changes; all recommendations adopted
(operator, 2026-08-10). Open ends resolved: begin/end verbs kept;
`ctx.credentialManager` kept as the context key with `managesCredentials`
as the declaration; `session()` on every context (local-only);
identity carries claim fields only; `beginSession(credential)`
single-argument; locking per §8. Naming: provenance field `origin`;
entity name Session kept with the principal-correspondence note.

Rev 3 (grants model, operator-ruled): user-facing workspace
functionality kept; plurality contained in the manager; engine
consumer view stays scalar; vocabulary shifts from per-workspace
sessions to grants (list / use / forget). The product-team framing
updates accordingly: functionality kept, ontology fixed, the
multi-entry consistency surface now properly owned by one modeled
component. Delta re-review pending.
