# Credential manager — design (for review)

Status: operator-approved direction (2026-08-10), pre-implementation
design review pending (architect + principal engineer). Amends the v8
draft on acceptance. Author: orchestrator, from the operator design
discussion of 2026-08-10.

## 1. Why this exists

The engine gives commands two auth surfaces: `ctx.api` (consume the
management API) and `ctx.getCredentials` (read the resolved
credential). Neither models the thing auth commands operate ON — the
credential machinery itself. The S2a auth-family port exposed the gap:
every auth command imported around the engine to reach the credential
store, and the ported surface reproduced the legacy CLI's
per-workspace credential registry, which contradicts the settled
premise (draft: "Workspace selection is session state, not a
credential").

Evidence trail behind the direction (operator-reviewed in full):

- A 17-tool survey of developer CLIs found no precedent for a
  registry of same-identity workspace-scoped credentials with
  per-workspace login/logout; the universal model is one identity +
  workspace as context; where scoped access tokens are required they
  are minted invisibly from one root credential (Azure/MSAL, AWS SSO).
- Control-plane validation (pdp-control-plane): user OAuth tokens are
  workspace-bound at consent time (`workspace_id` claim; authz checks
  the claim); refresh cannot re-scope; the multi-workspace
  authorization primitive (`ActorUser`) exists and serves Console, but
  OAuth-issued user tokens do not use it today. Service tokens are
  narrower still.
- Operator constraints: the platform's auth systems are not changing
  now; the settled engine design (one credential) is not changing;
  the registry surface is dropped.

## 2. Ruled outcomes this design implements

R1 The engine models the credential machinery as a first-class
   surface named the **credential manager** (operator: "rather than
   credential store, let's call this thing a manager… the surface we
   present over it ought to be a bit more user-centric").
R2 The auth state is a SCALAR: at most one session. Login replaces;
   there is no registry, no cursor, no per-entry lifecycle.
R3 The command tree: `auth login`, `auth logout`, `auth whoami`.
   The `auth workspace` subgroup (`list`/`use`/`logout`) and
   `auth logout --workspace` are dropped. Switching workspace =
   `prisma auth login` (re-consent; the consent screen is the
   workspace picker today). Divergence-list entries accompany.
R4 Migration: an existing multi-entry legacy store is adopted by its
   ACTIVE entry only; other entries are ignored (re-login reachable).

## 3. Entities

**Identity** — who is authenticated. `{ kind: "user"; id: string;
email?: string }` | `{ kind: "service"; label?: string }`. Derived
from credential claims/provenance; never independently stored.

**Credential** — the proof: token material + mechanics.
`{ token: string; refreshToken?: string; expiresAt?: Date;
method: "oauth" | "service-token" }`. Machine-facing; `ctx.api` fuel.
(The engine's current `Credentials { token }` consumer shape is the
projection of this that request-signing needs.)

**Session** — the user-centric composite and the manager's primary
read model: `{ identity: Identity; method: "oauth" | "service-token";
scope: Scope; expiresAt?: Date }`. At most one. Mostly derivable from
the credential today; kept distinct because (a) commands speak
meaning, not material; (b) provenance is session truth the token does
not carry (env-supplied sessions have no stored credential and refuse
`endSession`); (c) the future multi-workspace scope adds selection
state no token encodes.

**Scope** — what the session reaches:
`{ workspaces: readonly WorkspaceRef[] }` where `WorkspaceRef =
{ id: string; name?: string }`. Today exactly one element (the
consent-time claim). When OAuth tokens route onto the platform's
`ActorUser` primitive, the set grows — data change, not shape change.

## 4. The CredentialManager interface

```ts
interface CredentialManager {
  /** The user-centric truth. Composes environment + stored
   *  credentials; an env service token wins over a stored OAuth
   *  credential (today's precedence, preserved). */
  session(): Promise<Session | null>;

  /** Login's write. begin/end verbs carry the scalar invariant:
   *  beginning a session REPLACES any prior one. */
  beginSession(credential: Credential, identity: Identity, scope: Scope): Promise<Session>;

  /** Logout. Rejects with a structured error when the active session
   *  is env-supplied (fix: names the env var to unset). */
  endSession(): Promise<void>;

  /** The consumer path (absorbs Runtime.getCredentials). Resolves
   *  the credential that authorizes a request NOW: returns the
   *  session's credential, refreshing internally when expired.
   *  FUTURE SLOT: scope-targeted resolution (mint/exchange) lands
   *  here as an additive parameter. */
  credential(): Promise<Credential | null>;
}
```

Custody boundary: the manager never CREATES credentials. Sources are
(1) the login flow (auth-module machinery: browser, consent, SDK code
exchange → the token service mints; the command hands the result to
`beginSession`); (2) refresh (the SDK's refresh exchange with the
manager as its token storage; rotation persisted internally, invisible
above); (3) the environment (`PRISMA_SERVICE_TOKEN`, composed at read
time, never stored); (4, future) scope-targeted exchange inside
`credential()`.

## 5. Engine integration

- `Runtime.getCredentials` is REPLACED by `Runtime.credentialManager:
  CredentialManager` (the bin wires the auth module's implementation
  over the existing on-disk store; the engine derives everything it
  previously derived from `getCredentials` via
  `manager.credential()`):
  - the `needs.credentials` early check;
  - `ctx.getCredentials` (kept, as the read-only consumer view);
  - `ctx.api`'s per-request token source (which restores refresh to
    the v8 path — the current implementation passes no refresh token
    and treats 401 as terminal).
- Write access is DECLARED: `needs: { credentialManager: true }` puts
  the full manager on the context (`ctx.credentialManager`) for
  `auth login` / `auth logout` only. All other commands keep the
  read-only surfaces.
- `session()` is also exposed read-only on every context
  (recommendation; open end §8.3) so `whoami` needs no write
  declaration.
- Harness: `createTestCli({ session?: Session; credential?:
  Credential })` seeds an in-memory manager; `login`/`logout` become
  engine-testable; `whoami` tests seed sessions instead of mocking
  module internals.
- Draft amendments on acceptance: §4 (context surfaces), §6
  (`needs.credentialManager`), §10 (`Runtime.credentialManager`
  replacing `getCredentials`), §11 (harness seeding).

## 6. Runtime flows (normative behaviors)

**Unauthenticated.** `needs.credentials` → engine fails early with
`CLI.CREDENTIALS_REQUIRED` (exit 2, sign-in nextAction), handler never
loads. Bare `ctx.api` touch → the same structured error thrown at
request time (single constructor). `whoami` → completes, "signed
out", exit 0. No auto-login anywhere (standing Q1 default).

**Access token expired, refresh alive.** `ctx.api` request → 401 →
SDK refresh with the manager as token storage, under the existing
file lock (concurrent CLI processes: one refresher wins, the loser
re-reads); rotated pair persisted including the rotated refresh
token; request retried. Consumers never notice; per-request token
resolution keeps long runs current. The manager MAY refresh
preemptively off the `exp` claim.

**Refresh dead (true session expiry).** Transient failures (network,
5xx): surface the API error; do NOT touch the stored credential.
Definitive rejection (`invalid_grant` / `AuthError.refreshTokenInvalid`):
the manager clears the dead credential (self-cleaning; no stale-state
resurrection) and the command settles `CLI.CREDENTIALS_REQUIRED` with
the `why` phrased as expiry. Same code as unauthenticated; different
reason text.

**Service token.** No refresh path. 401 → structured error naming
`PRISMA_SERVICE_TOKEN` with a Console-pointing fix; nothing cleared.
Set-but-blank keeps its existing typed error.

## 6a. Switching sessions

There is no "switch between" stored sessions — at most one exists.

- **Workspace, same identity**: `prisma auth login` again; re-consent
  (the consent screen is the picker), the new session replaces the
  old. With a live auth-service browser session this is
  consent-only.
- **To/from a service token**: set/unset `PRISMA_SERVICE_TOKEN` —
  the env credential wins over the stored session at read time,
  per-invocation or per-shell, without disturbing the stored
  session (also the scripts/parallel-terminal override).
- **Different identity**: log in as the other account; replace. No
  multi-account registry (a distinct feature, additive later if
  ever wanted).
- **Known trade-off**: simultaneous user-auth work in two workspaces
  in parallel terminals is not served (accepted in the product-case
  ruling; mitigations: a service token in one terminal, or the
  future `ActorUser` routing, after which switching never touches
  credentials).

## 7. Future direction fit

- OAuth → `ActorUser` routing (platform work, not scheduled): scope
  becomes multi-element; `auth workspace use` may RETURN as a pure
  context command writing session state; additive tree change.
- Token narrowing/minting: `credential()` gains a scope argument;
  exchange happens inside the manager; nothing above changes.
- New auth methods: new `Identity.kind` / `Credential.method` values.

## 8. Open ends for the design review

1. Verbs: `beginSession`/`endSession` (invariant-carrying) vs plainer
   `replace`/`clear`. Author recommends begin/end.
2. Context key: `ctx.credentialManager` (honest, long) — better name
   welcome; `ctx.auth` rejected as vague.
3. `session()` on the read-only context for every command (author
   recommends yes — see §5).
4. `Identity` display fields (email) from claims vs minimal identity
   + API enrichment in `whoami`. Author recommends carrying claim
   fields (offline `whoami` stays useful).
5. Whether `beginSession` takes (credential, identity, scope) as
   separate arguments or a single `NewSession` object; the login flow
   derives identity and scope from the credential's claims — should
   the MANAGER do that derivation instead (guaranteeing consistency)?
6. Locking/atomicity contract for the store files under the manager
   (the legacy machinery's split-brain env vars and read-path writes
   must not survive the reimplementation).
