import type { TokenStorage } from "./management-api";

/**
 * The proof material. Only ever seen by the login flow (which mints
 * it) and createSession (which stores it).
 */
export interface Credential {
  readonly token: string;
  readonly refreshToken: string | undefined;
  readonly expiresAt: Date | undefined;
}

/**
 * "Logged-in-edness", scoped to a workspace. Identified to users by
 * its workspace. The token is INTERNAL: it lives in the stored
 * record, never on this public shape. `source: "environment"` marks
 * the ephemeral session composed from PRISMA_SERVICE_TOKEN; it never
 * appears in sessions().
 */
export interface Session {
  readonly workspaceId: string;
  readonly workspaceName: string | undefined;
  readonly expiresAt: Date | undefined;
  readonly source: "stored" | "environment";
  readonly current: boolean;
}

/**
 * Manages sessions — a set of per-workspace sessions, one current.
 * Six user-facing operations plus one engine-facing accessor. Custody
 * only: never opens a browser, never prompts, never talks to the
 * user. Env is a construction input — nothing below the manager reads
 * process.env. The manager resolves no user input: commands resolve
 * refs against sessions() and pass the matched Session.
 */
export interface CredentialManager {
  /**
   * The session this PROCESS is acting as. Pinned at first read:
   * composed from the env token if set, else the file's current
   * marker at that moment; later marker changes by other processes do
   * not move it. This process's own mutations DO update it.
   * Local-only: never touches the network.
   */
  currentSession(): Promise<Session | null>;

  /**
   * The available sessions, read fresh from the file. Local-only.
   * Under an env override the file's current marker is still shown as
   * `current`.
   */
  sessions(): Promise<readonly Session[]>;

  /**
   * Login's write. The caller names the workspace that identifies the
   * session; for workspace-bound credentials the manager verifies the
   * workspace_id claim matches and refuses on mismatch. Upserts by
   * workspaceId, sets the file marker, becomes this process's
   * current. The workspace name is fetched best-effort after the
   * write — failure leaves it undefined, never fails login.
   */
  createSession(credential: Credential, workspaceId: string): Promise<Session>;

  /**
   * Switch: sets the file's current marker AND this process's pinned
   * session. The argument is a workspace reference — only workspaceId
   * is read, re-validated against freshly-read state.
   */
  useSession(session: Session): Promise<Session>;

  /**
   * Log out of one workspace: remove that session. If it was current
   * (file marker or this process's pin), that current is cleared (no
   * auto-promotion).
   */
  endSession(session: Session): Promise<void>;

  /** Log out entirely: remove all sessions and the marker. */
  endAllSessions(): Promise<void>;

  /**
   * ENGINE-FACING, not a user operation: the SDK TokenStorage view
   * for one workspace's session. The engine forwards it into SDK
   * client config and never calls its methods itself.
   */
  tokenStorage(workspaceId: string): TokenStorage;
}
