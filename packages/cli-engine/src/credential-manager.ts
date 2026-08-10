import type { ManagementApiClient } from "./management-api";

/**
 * Who is signed in. One identity per login; every held grant belongs to
 * it. Claim-derived fields only.
 */
export type Identity =
  | {
      readonly kind: "user";
      readonly id: string;
      readonly email: string | undefined;
    }
  | {
      readonly kind: "service";
      readonly id: string | undefined;
      readonly label: string | undefined;
    };

/** Credential material. Leaves the manager only through credential(). */
export interface Credential {
  readonly token: string;
  readonly refreshToken: string | undefined;
  readonly expiresAt: Date | undefined;
  readonly method: "user-oauth" | "service-token";
}

/**
 * A resolved workspace pair — NOT the id-or-name string users type
 * (that concept is called a ref). `name` is undefined unless an
 * explicit write recorded it; there is no read-path caching.
 */
export interface Workspace {
  readonly id: string;
  readonly name: string | undefined;
}

/**
 * The scalar view of the auth state every engine consumer sees.
 * `origin` distinguishes an env-supplied session from stored state (it
 * drives endSession's refusal and lets whoami explain an override);
 * `method` is how authenticated, a different axis from who
 * (identity.kind). `workspace` is the ACTIVE grant's workspace.
 */
export interface Session {
  readonly identity: Identity;
  readonly method: "user-oauth" | "service-token";
  readonly origin: "stored" | "environment";
  readonly workspace: Workspace;
  readonly expiresAt: Date | undefined;
}

/**
 * A held grant, as listed to the user. Structurally carries no
 * credential material. `active` is the cursor position; when an env
 * token overrides, the listing command must say the env session is
 * what is in force.
 */
export interface GrantSummary {
  readonly workspace: Workspace;
  readonly expiresAt: Date | undefined;
  readonly active: boolean;
}

/**
 * The credential machinery, modeled: one identity, plural workspace
 * grants (workspace + the credential the user's consent minted for
 * it), one active grant. The plurality lives entirely inside the
 * manager; every consumer surface is scalar. The manager holds custody
 * only: it never opens a browser, never prompts, never talks to the
 * user. Env is a construction input — nothing below the manager reads
 * process.env.
 */
export interface CredentialManager {
  /**
   * User-centric truth. Local-only: composes env + stored state,
   * decodes claims, NEVER touches the network. An env service token
   * wins over a stored credential (origin: "environment"); whoami is
   * responsible for surfacing the override.
   */
  session(): Promise<Session | null>;

  /**
   * Login's write. Derives identity, workspace, and expiry from the
   * credential's claims. Same identity as the held grants: UPSERTS
   * the grant for that workspace and makes it ACTIVE; other grants
   * untouched. Different identity: all existing grants are discarded
   * and replaced by this one — the one-identity invariant is enforced
   * here.
   */
  beginSession(credential: Credential): Promise<Session>;

  /**
   * Logout, whole-identity. Local (does not revoke server-side).
   * Clears ALL grants and the cursor. Rejects with a structured error
   * when the active session is env-supplied; the error's why states
   * whether stored grants also exist.
   */
  endSession(): Promise<void>;

  /**
   * The held grants, as summaries (no credential material).
   * Local-only like session(): never touches the network.
   */
  grants(): Promise<readonly GrantSummary[]>;

  /**
   * Records a human-readable workspace name learned by a command. The
   * sanctioned name-write path — beginSession stays single-argument
   * and claims-only. Explicit write; never a read-path side effect.
   * No grant held for that workspace id → no-op, not an error. Only
   * `login` and `workspace use` may call it (both already mutate).
   */
  rememberWorkspaceName(workspaceId: string, name: string): Promise<void>;

  /**
   * Move the cursor to a HELD grant. Ref resolution is the manager's,
   * against held grants only: exact id first, then case-insensitive
   * name; ambiguity is a structured error; no match is a structured
   * error the COMMAND catches to run the consent flow + beginSession.
   * Activating an expired grant succeeds locally and fails at first
   * use.
   */
  activateGrant(ref: string): Promise<Session>;

  /**
   * Drop one grant. If it was active, the cursor clears (no
   * auto-promotion of another grant).
   */
  forgetGrant(ref: string): Promise<void>;

  /**
   * The authenticated management API client, constructed and owned by
   * the MANAGER. Credential RESOLUTION is internal: the manager
   * resolves the credential that authorizes a request inside this
   * method and the needs check — no public method returns credential
   * material (internal invariant: resolution yields null ⟺ session()
   * is null). Clients are cached per workspace id; any cursor-moving
   * mutation (beginSession, activateGrant) invalidates the cached
   * active client.
   */
  apiClient(): Promise<ManagementApiClient>;
}
