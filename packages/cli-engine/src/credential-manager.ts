import type { TokenStorage } from "./management-api";

/** The environment variables that supply a credential to a process: a
 *  service token, plus the workspace it acts in when the token's own
 *  claims name none. EnvironmentCredentialManager reads the pair; the
 *  spawn path writes it into a child's environment. */
export const SERVICE_TOKEN_ENV_VAR = "PRISMA_SERVICE_TOKEN";
export const WORKSPACE_ID_ENV_VAR = "PRISMA_WORKSPACE_ID";

/**
 * The proof material. Seen by the login flow (which mints it),
 * createSession (which stores it), and the engine (which authenticates
 * with it). Never reaches a command.
 */
export interface Credential {
  readonly token: string;
  readonly refreshToken: string | undefined;
  readonly expiresAt: Date | undefined;
}

/**
 * A stored logged-in-ness for one workspace — the only thing called a
 * session. It is what `sessions()` lists, what `selectSession` selects,
 * and what `endSession` ends. The credential behind it is internal.
 */
export interface Session {
  readonly workspaceId: string;
  readonly workspaceName: string | undefined;
  /** The stored ACCESS TOKEN's expiry, which rotation changes — not a
   *  deadline on the logged-in-ness. */
  readonly expiresAt: Date | undefined;
}

/**
 * The stored sessions and which one is selected, read together: reads
 * take no lock, so two reads could straddle a write and disagree.
 * `selectedWorkspaceId` always names one of the listed sessions or is
 * absent — a dangling selection never escapes the manager.
 */
export interface StoredSessions {
  readonly sessions: readonly Session[];
  readonly selectedWorkspaceId: string | undefined;
}

/** Who the active credential belongs to, decoded from its own claims by
 *  the manager so no command ever holds a token to decode. */
export interface CredentialIdentity {
  readonly userId: string | undefined;
  readonly email: string | undefined;
  /** Only an online lookup supplies this; a token's claims do not
   *  carry it. */
  readonly name: string | undefined;
}

/**
 * Where the active credential came from — a question about the
 * resolution, not about a session.
 */
export interface CredentialOrigin {
  /** Exists to be PRINTED: it feeds whoami's `source` field verbatim.
   *  Outside whoami's renderer and the credential-rejected error,
   *  comparing against this is a defect. */
  readonly source: "stored" | "environment";
}

/**
 * What this process authenticates as. Carries no token material.
 */
export interface ActiveCredential {
  /** Absent when nothing names it — an environment token whose claims
   *  carry no workspace. Never the empty string. */
  readonly workspaceId: string | undefined;
  readonly workspaceName: string | undefined;
  readonly expiresAt: Date | undefined;
  readonly identity: CredentialIdentity | undefined;
  readonly origin: CredentialOrigin;
}

export interface ActiveAccessTokenOptions {
  /** Refuse or refresh a token with no more than this lifetime left. */
  readonly minimumValidityMs: number;
  readonly now: Date;
  readonly signal: AbortSignal;
}

/**
 * Manages the credentials this machine holds: the stored per-workspace
 * sessions, which one is selected, and the credential this process
 * authenticates as. Custody only — never opens a browser, never
 * prompts, never talks to the user. Env is a construction input;
 * nothing below the manager reads process.env. It resolves no user
 * input: commands resolve refs against `sessions()` and pass a
 * workspace id.
 */
export interface CredentialManager {
  /**
   * What this process authenticates as. The DECISION — which
   * credential, and from where — is pinned at first read; the material
   * is read through the storage on every call, so a session replaced by
   * another process still resolves. Local-only: never touches the
   * network.
   */
  activeCredential(): Promise<ActiveCredential | null>;

  /** The stored sessions and the selection, read fresh. Local-only. */
  sessions(): Promise<StoredSessions>;

  /**
   * Login's write. The caller names the workspace that identifies the
   * session; for workspace-bound credentials the manager verifies the
   * workspace_id claim matches and refuses on mismatch. Upserts by
   * workspaceId and selects it. The workspace name is fetched
   * best-effort after the write — failure leaves it undefined, never
   * fails login.
   */
  createSession(credential: Credential, workspaceId: string): Promise<Session>;

  /**
   * Select a session. Refuses a workspace with no session: there is no
   * state in which it would afterwards be selected. Never sees the
   * environment credential.
   */
  selectSession(workspaceId: string): Promise<Session>;

  /**
   * End one workspace's session. Idempotent — a workspace with no
   * session is already in the state this asks for. Clears the selection
   * if it named that session; never auto-promotes another.
   */
  endSession(workspaceId: string): Promise<void>;

  /** End every session and clear the selection. */
  endAllSessions(): Promise<void>;

  /**
   * ENGINE-FACING. Where the SDK reads and writes the active
   * credential's tokens: file-backed for a stored session, memory-backed
   * for one with no home record. Zero-argument because process pinning
   * already ruled there is one credential per process, and an
   * environment credential may have no workspace id to key on. Only
   * valid once `activeCredential()` has returned non-null.
   *
   * The engine forwards the storage into SDK client config and never
   * calls its methods itself — no exceptions. The engine's own read of
   * token material goes through `activeAccessToken()`.
   */
  activeCredentialStorage(): Promise<TokenStorage>;

  /**
   * ENGINE-FACING. The active credential's ACCESS token, read fresh on
   * every call, for handing to a child process that authenticates as
   * this process does. An OAuth pair inside the caller's minimum
   * validity is refreshed under the refresh lock before its access
   * token is returned. Never the refresh token: the child gets a
   * snapshot it cannot refresh. Null when the material is gone (the
   * session ended).
   */
  activeAccessToken(options: ActiveAccessTokenOptions): Promise<string | null>;
}
