# Credentials and Sessions

How the CLI stores credentials, decides which one a process authenticates as, refreshes OAuth tokens, and hands a credential to a child process. The contract is `CredentialManager` in `packages/cli-engine/src/credential-manager.ts`. The CLI's implementation is `FileCredentialManager` in `packages/cli/src/auth/credential-manager.ts`, with the file format and locks in `packages/cli/src/auth/state-file.ts` and legacy-store adoption in `packages/cli/src/auth/legacy-state.ts`. The engine consumes the manager in `packages/cli-engine/src/execution/needs.ts` (the credentials check), `execution/api-client.ts` (`ctx.api`), and `execution/spawn.ts` (child credentials).

## What the server does

Everything here follows from how the Prisma platform issues tokens.

- `prisma auth login` produces exactly one kind of credential: an OAuth access and refresh token pair scoped to one workspace. The user picks the workspace on the consent screen. The CLI cannot request or pin a workspace, because the authorize request carries no workspace parameter. The CLI learns which workspace it got by decoding the token's claims, and a refresh cannot change the workspace.
- A token names its workspace one of two ways: an OAuth token carries a `workspace_id` claim, and a service token carries `sub: "workspace:<id>"` and no `workspace_id`. `credentialWorkspaceId` in `packages/cli-engine/src/token-claims.ts` is the one derivation for both. Claims are decoded, never verified: they are used for display and for keying, never for authorizing.
- Refresh tokens are single-use with a ten-second reuse grace: rotation marks the token used, one replay within ten seconds succeeds and issues its own pair, and later replays answer `invalid_grant`. Rotation does not revoke sibling pairs, so any pair that was successfully issued stays valid on its own. Two processes refreshing the same session therefore both end up with a working pair, whichever write lands last.
- `PRISMA_SERVICE_TOKEN` supplies a workspace-scoped bearer token from the environment. It carries no refresh token, so nothing rotates it, and it is never written to disk.
- Tokens carry identity claims (`sub`, `email`) but the stored state enforces no identity. One store may hold sessions minted by different accounts; identity is decoded for display only.

The endpoints are `PRISMA_MANAGEMENT_API_URL` (default `https://api.prisma.io`) and `PRISMA_AUTH_BASE_URL` (default `https://auth.prisma.io`), read in `packages/cli/src/auth/client.ts` beside the OAuth client id.

## Three things, kept separate

A **session** is a stored logged-in state for one workspace: `{ workspaceId, workspaceName, expiresAt }`. Sessions are keyed by workspace id, so there is at most one per workspace, and logging in to the same workspace again replaces its credential. `expiresAt` is the stored access token's expiry, which rotation moves; it is not a deadline on the session. Sessions are what `sessions()` lists, `selectSession` selects, and `endSession` ends.

The **selection** is one scalar of stored state: the workspace whose session is used when a session is needed. `sessions()` returns it together with the list as `StoredSessions { sessions, selectedWorkspaceId }`, in one read, because reads take no lock and two reads could straddle a write. The manager guarantees `selectedWorkspaceId` either names a listed session or is absent; a dangling selection never leaves the manager.

The **active credential** is what this process authenticates as: `{ workspaceId, workspaceName, expiresAt, identity, origin }`. It carries no token material. `origin.source` is `"stored"` or `"environment"`; it exists to be printed (`whoami`'s `source` field) and to pick the wording of one error, and comparing against it anywhere else is a defect. `workspaceId` is absent, never the empty string, when an environment token's claims name no workspace.

Vocabulary: in code the word is *selected* (`selectedWorkspaceId`, `selectSession`). Two places keep *current* and are not to be renamed: the on-disk field `currentWorkspaceId`, and the user-facing surface (`auth workspace use`, and `auth workspace list`'s `context.currentWorkspaceId` and per-item `current`).

## The interface

```ts
interface CredentialManager {
  activeCredential(): Promise<ActiveCredential | null>;
  sessions(): Promise<StoredSessions>;
  createSession(credential: Credential, workspaceId: string): Promise<Session>;
  selectSession(workspaceId: string): Promise<Session>;
  endSession(workspaceId: string): Promise<void>;
  endAllSessions(): Promise<void>;
  activeCredentialStorage(): Promise<TokenStorage>;
  activeAccessToken(options: ActiveAccessTokenOptions): Promise<string | null>;
}
```

The first six are what the auth commands call. The last two are engine-facing: `activeCredentialStorage()` is the SDK `TokenStorage` the engine forwards into the API client, and `activeAccessToken()` is the one way the engine reads token material, for a child process.

Rules every implementation follows:

- The manager never opens a browser, never prompts, and never talks to the user. Login mints a credential elsewhere and hands it to `createSession`.
- `env` is a construction input. Nothing below the manager reads `process.env`.
- The manager resolves no user input. Commands resolve a typed workspace reference against `sessions()` (exact id first, then case-insensitive name) in `packages/cli/src/commands/auth/session-ref.ts` and pass the matched workspace id. A reference that matches nothing is `AUTH.NO_SESSION_FOR_WORKSPACE`; several matches are `AUTH.WORKSPACE_AMBIGUOUS`.
- `createSession` refuses a credential whose workspace claim names a different workspace than the one it is being stored under (`AUTH.CREDENTIAL_WORKSPACE_MISMATCH`).
- `selectSession` refuses a workspace with no session; there is no state in which it would afterwards be selected.
- `endSession` is idempotent: a workspace with no session is already in the requested state, so it writes nothing and succeeds. The mistyped-reference error is raised command-side, before the manager is reached.
- Ending the selected session clears the selection; nothing is auto-promoted.

Three implementations exist. `FileCredentialManager` (`packages/cli/src/auth/credential-manager.ts`) is the CLI's, over the state file described next. `EnvironmentCredentialManager` (`packages/cli-engine/src/environment-credential-manager.ts`) ships in the engine for hosts whose only credential source is the environment pair `PRISMA_SERVICE_TOKEN` and `PRISMA_WORKSPACE_ID`, such as a child process this CLI spawned; it holds no sessions and every mutation throws `AUTH.SESSIONS_UNSUPPORTED`. `InMemoryCredentialManager` (the engine's `./testing` subpath) implements the same rules over memory, with a seed and a state read-back for tests.

## What is stored where

The state file is `PRISMA_AUTH_FILE` when set; `PRISMA_COMPUTE_AUTH_FILE` is a deprecated alias the bin warns about once per process. Otherwise it is `~/Library/Application Support/prisma/auth.json` on macOS, `%APPDATA%\prisma\auth.json` on Windows, and `$XDG_CONFIG_HOME/prisma/auth.json` (default `~/.config`) elsewhere.

The file is JSON, mode 0600:

```json
{
  "version": 1,
  "sessions": [
    {
      "workspaceId": "...",
      "name": "...",
      "user": { "id": "...", "email": "...", "name": "..." },
      "token": "...",
      "refreshToken": "...",
      "expiresAt": "..."
    }
  ],
  "currentWorkspaceId": "... or null",
  "tokens": [{ "workspaceId": "...", "token": "...", "refreshToken": "..." }]
}
```

`name`, `user`, `refreshToken`, and `expiresAt` are optional. `user` is safe account metadata captured at login for labelling sessions; the token stays the only thing that authenticates. `tokens` is a mirror of the sessions in the record shape the 3.x `@prisma/cli` reads, so a 3.x CLI sharing this file keeps seeing the sessions; this CLI's reader branches on `sessions` before it looks at `tokens`, so the mirror is invisible to it. For the same reason every write keeps the `activeWorkspaceId` pointer in the sibling `auth.context.json` in step with `currentWorkspaceId`, and `endAllSessions` deletes that sidecar.

A file with `tokens` but no `sessions` is a legacy store and is adopted on read (`legacy-state.ts`): every entry whose token decodes to a workspace becomes a session keyed by that workspace, the last of several entries for one workspace wins, a legacy name equal to `Unknown workspace` or to the workspace id adopts as no name, entries without a refresh token adopt, and the selection comes from the context sidecar's pointer when the sidecar exists (a dangling or null pointer means nothing selected) or from the single entry when there is no sidecar and exactly one entry. Adoption is a pure read. The first mutation writes the adopted set in the current shape; it re-reads (and so re-adopts) inside the lock, so a current-shape state another process wrote meanwhile wins.

A file that is missing reads as empty. A file that exists but cannot be read is `CLI.CREDENTIALS_UNREADABLE`. A file that parses to nothing usable reads as signed out and is never rewritten by a read; the next login replaces it.

Writes are atomic: a temp file in the same directory, opened exclusively with mode 0600, written, fsynced, and renamed over the state file, after which the file's mode is tightened to 0600. A write that fails before the rename unlinks its temp file, because the temp file holds the whole state, tokens included. `endAllSessions` also deletes any temp files a crashed write left behind. Reads never write and take no lock: the rename guarantees a reader sees a complete state.

## Which credential a process acts as

A process decides once, at its first `activeCredential()` call, and the decision holds for the process's lifetime:

1. If `PRISMA_SERVICE_TOKEN` is set, the process acts as the environment credential. A blank or whitespace value is `AUTH.SERVICE_TOKEN_EMPTY`, raised identically from every read and every mutation while the variable is set.
2. Otherwise, if the file's `currentWorkspaceId` names a stored session, the process acts as that session.
3. Otherwise the process acts as nothing. `activeCredential()` returns `null` when no sessions are stored and throws `CLI.CREDENTIALS_REQUIRED` with the "sessions held, none selected" wording when sessions exist but none is selected.

Another process moving the selection or replacing records does not redirect a running process; a new process picks up the new selection. When no environment credential is in force, the process's own mutations do move it: `createSession` and `selectSession` make the process act as that session, and `endSession` of the session it acts as and `endAllSessions` make it act as nothing. Each of those discards the storage built for the previous decision, so a command that mutates and then reaches for `ctx.api` gets the credential it now acts as.

What is pinned is the decision, not the material. Every read goes back to the file, so a session another process replaced still resolves, and a session another process ended fails at the next read with `CLI.CREDENTIALS_REQUIRED` in its "session ended" wording.

While `PRISMA_SERVICE_TOKEN` holds a non-blank value, every mutation still succeeds: selecting or ending a stored session changes stored state while this process keeps authenticating as the environment credential. The commands print a one-line notice that the environment credential remains in force until the variable is unset.

## How the engine authenticates a command

A command declares `needs: { credentials: true }`. Before the handler runs, the engine's needs check calls `activeCredential()`; `null` is `CLI.CREDENTIALS_REQUIRED`, and a structured error from the manager passes through verbatim. `ctx.activeCredential()` and the first `ctx.api` call go through the same method, so all three raise the same error for the same state. `auth whoami` declares no credentials need: it calls `ctx.activeCredential()` itself and reports signed out.

`ctx.api` is the management API client, and the engine constructs and owns it: one client for the active credential, built lazily on the first method call and memoized for the run (`execution/api-client.ts`). It is always the SDK's refreshing client, `createManagementApiSdk({ ...managementApiClientConfig, tokenStorage })`, over the storage `activeCredentialStorage()` returns, whatever the credential's origin: a credential refreshes if it has a refresh token, and nothing hard-codes "environment means never refresh". The bin injects `Runtime.managementApiClientConfig` (`clientId`, `redirectUri`, `apiBaseUrl`, `authBaseUrl`; all four, because the SDK's refreshing fetch requires the full config) beside `Runtime.credentialManager`. The engine forwards the storage into the SDK and does not drive it; its one direct read is `getTokens()` during failure mapping, to ask whether the token set that failed had a refresh token at all.

`activeCredentialStorage()` returns one of two storages, chosen when the decision resolves:

- **File-backed**, for a stored session. `getTokens` re-reads the file on every call, with no memory layer in front. That read-through is what lets the SDK recover when another process already rotated: this process sees the newer pair, skips the exchange, and retries. Writes take the state lock.
- **Memory-backed**, for the environment credential. It closes over one variable, is never given the file's path, and touches no file from any method, including `clearTokens`, so an environment credential whose workspace matches a stored session cannot delete that session. The SDK's `Tokens` requires a `workspaceId`; when the claims name none, the storage supplies a fixed placeholder that never leaves the manager.

A command that declares `managesCredentials: true` also gets `ctx.credentialManager`. Exactly five commands do: `auth login`, `auth logout`, `auth workspace list`, `auth workspace use`, and `auth workspace logout`.

## Refresh

The SDK drives refresh on a 401. It calls the storage's `withRefreshLock`, re-reads the tokens inside it, skips the exchange when they no longer match the pair that failed, otherwise posts the refresh token to the token endpoint, writes the rotated pair with `setTokens`, and retries the request. The file-backed storage's `withRefreshLock` holds two locks: an in-process promise chain, so callers in one process run one at a time, and a cross-process file lock (`<state file>.refresh-lock`) held across the whole read, exchange, and write, so two processes never spend the same refresh token. The refresh lock is separate from the state lock because it is held across network I/O.

The file-backed storage's write rules:

- `setTokens` updates only `token`, `refreshToken`, and `expiresAt` of its workspace's record, in place. It never creates a record, never moves the selection, and never touches `name` or `user`. If the record is gone (ended by another process) it throws `CLI.CREDENTIALS_REQUIRED` rather than resurrect it. If the rotated token's workspace claim disagrees with the record's workspace it throws `AUTH.CREDENTIAL_WORKSPACE_MISMATCH`. The expiry comes from the new token's `exp` claim, else the expiry the caller passed, else the record's existing one, so an SDK-driven rotation (which passes no expiry) does not erase one a proactive refresh stored.
- `clearTokensIfCurrent` removes the record only if its stored `workspaceId`, `accessToken`, and `refreshToken` all still equal the pair that failed. This exact match is what makes a stale replay's `invalid_grant` harmless when a newer pair is already stored. Do not simplify it.
- `clearTokens` removes the record this process acts as and clears the selection if it named it. It never means "end all sessions".

The engine maps a request failure by state, never by parsing messages (`mapRequestFailure` in `execution/api-client.ts`):

- A `CliStructuredError` anywhere in the cause chain (the SDK wraps non-SDK errors in `FetchError`) surfaces as itself. This is how a manager error thrown from `setTokens` reaches the user.
- An SDK `AuthError` with `refreshTokenInvalid === true` (the token endpoint answered `invalid_grant`, and the SDK already ran `clearTokensIfCurrent`) is `CLI.CREDENTIALS_REQUIRED` in its "expired" wording for a stored session, and `AUTH.SERVICE_TOKEN_REJECTED` for the environment credential.
- A refresh the SDK refused because the token set carries no refresh token is a credential that could never have been renewed: `AUTH.SERVICE_TOKEN_REJECTED` for the environment credential, "expired" for a stored session without a refresh token (a legacy entry adopted without one).
- Any other `AuthError` on a stored session re-reads `sessions()`: the session gone is "session ended", otherwise `CLI.AUTH_SERVICE_ERROR`, a transient failure of the auth service that cleared nothing.
- A failure from the refresh path that is not an `AuthError` (the SDK throws a plain `Error` when a rotated token will not decode) is `CLI.AUTH_SERVICE_ERROR` too.

There is no background or pre-emptive refresh for ordinary commands; per-request refresh keeps long runs current. The one proactive refresh is for child processes, below.

## Locks and mutations

Every mutation is one `#mutate` call: acquire the state lock, re-read the file, apply one slice, write atomically if the slice produced a new state, release. No mutation writes state it read before acquiring the lock, and no network I/O runs under the state lock.

| Mutation | May modify |
| --- | --- |
| `createSession` | one record (upsert) and the selection; a second locked write attaches `name` and `user` |
| `selectSession` | the selection |
| `endSession` | one record, and the selection if it named it |
| `endAllSessions` | the whole state |
| `setTokens` | the token fields of the acting record |
| `clearTokens`, `clearTokensIfCurrent` | the acting record, and the selection if it named it |
| `enrichSessions` | `name` and `user` of records that lacked them |

The state lock is a lock file `<state file>.lock`, created exclusively and holding a random id. It is retried every 10 ms, a holder older than 5 s is treated as crashed, and a waiter gives up after 10 s with `CLI.CREDENTIALS_LOCKED`. A stale lock is taken over by renaming it aside and then confirming the moved file's mtime matches what was examined, so two waiters cannot both believe they cleared it and one cannot rename away a lock the other just created. The refresh lock uses the same mechanism at `<state file>.refresh-lock` with network-sized budgets: 100 ms retry, 30 s stale, 30 s wait.

## Login

`performLogin` (`packages/cli/src/auth/operations.ts`) runs the browser consent flow in `login.ts`: it starts a callback server on an ephemeral localhost port, opens the authorize URL in the browser, and when stdin is a TTY also accepts the callback URL pasted into the terminal. The SDK persists the minted tokens at callback time through a throwaway in-memory `TokenStorage`, never through the manager, and `performLogin` returns them as a `Credential { token, refreshToken, expiresAt }`. Minting and custody stay separate.

The `auth login` command reads the workspace from the credential's claims (`AUTH.LOGIN_WORKSPACE_UNKNOWN` if it names none) and calls `createSession(credential, workspaceId)`. The manager upserts the record and selects it under the lock, then, outside the lock, calls the injected `fetchSessionMetadata` (`session-metadata.ts`: one `GET /v1/me` with a 3 s timeout) for the workspace name and safe account fields, and attaches them in a second locked write only if the record still holds this exact token. A failed lookup leaves them absent and never fails login.

Names and users are otherwise never refreshed from the network: `sessionsForDisplay` (`enrichSessions`) fills in a missing name or user when a listing command runs, and never replaces one already stored. A renamed workspace keeps its stored name until the next login to it.

## Handing a credential to a child

A command that spawns a program which must authenticate as this process declares `maySpawn` and `needs: { credentials: "child" }`. The child gets an access-token snapshot it cannot refresh, so the engine makes sure the snapshot will last:

1. In the needs check, before the handler, `activeAccessToken({ minimumValidityMs: 5 minutes })`. A stored OAuth pair with less than five minutes left is refreshed under the refresh lock through `Runtime`'s injected `CredentialRefresher` (`packages/cli/src/auth/refresh.ts`, a POST to `${authBaseUrl}/token` with a 10 s timeout); the rotation is persisted before the new token is judged, and the new access token is returned. `invalid_grant` clears the current pair and is "expired"; a credential with no refresh token inside the window is refused with the "expiring soon" wording. This runs before the handler because pre-spawn work may create platform resources.
2. At `ctx.spawn`, `activeAccessToken({ minimumValidityMs: 0 })` reads the token again, so a rotation by another process in between is observed and only an already-expired token is refused.
3. The child's environment gets `PRISMA_SERVICE_TOKEN` set to that access token and `PRISMA_WORKSPACE_ID` set to the credential's workspace id, or deleted when the credential names none: the two variables are one protocol, written as a unit. They are applied last and cannot be overridden by the handler's `env`. The refresh token is never injected.

In the child, `EnvironmentCredentialManager` reads that pair: the token's own claims name the workspace when they can, and `PRISMA_WORKSPACE_ID` fills in when they do not. (The CLI's `FileCredentialManager` reads only the token's claims for the environment credential's workspace.)

The spawn-time read builds no second API client, so the engine's `ctx.api` client stays the only refreshing client the process constructs.

## The auth commands

| Command | Manager calls |
| --- | --- |
| `auth login` | `performLogin`, then `createSession(credential, workspaceId)` |
| `auth logout` | `sessions()` for the count, then `endAllSessions()` |
| `auth whoami` | `ctx.activeCredential()`, then a best-effort `GET /v1/me` through `ctx.api` (3 s timeout) whose fields win over the claims when both describe the same user |
| `auth workspace list` | `sessions()` through `sessionsForDisplay`, the selection marked `current` |
| `auth workspace use <ref>` | resolve the ref command-side, then `selectSession(workspaceId)`; it selects among the sessions you have and never opens a browser |
| `auth workspace logout <ref>` | resolve the ref command-side, then `endSession(workspaceId)` |

## Debugging

`PRISMA_DEBUG=1` makes the manager write to stderr: the resolved state file path, the acting-as decision, lock acquire, release, and takeover, and rotation and clear writes. The engine adds the client's refresh attempts and, on failure, the `AuthError`'s verdict without the endpoint's free text. Token material never appears in any log line, error, `meta`, or envelope.

## Invariants a change must not break

- Sessions are keyed by workspace id: one session per workspace, and `createSession` upserts.
- `selectedWorkspaceId` names a listed session or is absent.
- `Session` and `ActiveCredential` carry no token material; only the engine sees tokens, and only through `activeCredentialStorage()` and `activeAccessToken()`.
- The acting-as decision is made once per process and moved only by the process's own mutations; the material is read fresh on every call.
- Reads never write and take no lock. Every mutation re-reads under the state lock and writes one slice atomically. No network I/O runs under the state lock.
- The file-backed `getTokens` has no cache in front of it.
- `setTokens` never creates a record, never moves the selection, never re-scopes a session to another workspace, and never resurrects an ended one.
- `clearTokensIfCurrent` matches all three fields exactly.
- The memory-backed storage never touches the file.
- The environment credential is never stored and never refreshed; while it is in force, mutations change stored state but not what the process acts as.
- A child receives an access token and a workspace id, never a refresh token, and the parent refreshes a near-expiry pair before the handler runs.
- Refresh failures are classified by state (`refreshTokenInvalid`, whether the set had a refresh token, whether the session still exists), never by message text.
- `ctx.api` is one client per process, built by the engine over the manager's storage; the spawn path builds no second one.
- Login writes nothing through the manager until `createSession`.
- No token material in output, errors, `meta`, envelopes, or debug logs.

## A legacy module still in use

`packages/cli/src/auth/token-storage.ts` (`FileTokenStorage`) is the store from before the session model. `project transfer` still uses it through `recipient.ts` to validate the recipient workspace's stored session with its own SDK client pinned to that workspace; it is the one command that authenticates API requests with a stored session other than the active one, outside `ctx.api`. `guard.ts` and the rest of `operations.ts` beyond `performLogin` are reached only by tests.
