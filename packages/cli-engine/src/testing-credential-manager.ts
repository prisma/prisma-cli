import { Buffer } from "node:buffer";
import {
  credentialsRequiredError,
  environmentSessionMutationError,
} from "./credential-errors";
import type {
  Credential,
  CredentialManager,
  GrantSummary,
  Identity,
  Session,
  Workspace,
} from "./credential-manager";
import type { ManagementApiClient } from "./management-api";
import { CliStructuredError } from "./protocol";

const SERVICE_TOKEN_ENV_VAR = "PRISMA_SERVICE_TOKEN";

/** A held grant with its credential material, as seeded into and read
 *  back from the test credential manager. */
export interface TestGrant {
  readonly workspace: Workspace;
  readonly credential: Credential;
}

export interface TestCredentialManagerSeed {
  /** Preferred seed: runs beginSession's real claims derivation. The
   *  token must be a JWT (use mintTestJwt). */
  readonly credential?: Credential;
  /** Escape hatch: session() returns exactly this. origin
   *  "environment" seeds an env-override session; origin "stored"
   *  materializes one active grant with a synthesized credential. */
  readonly session?: Session;
  /** Grants-model seeding. `identity` is seedable independently of
   *  `grants`, so a grant whose token disagrees with the recorded
   *  identity is constructible. */
  readonly identity?: Identity;
  readonly grants?: readonly TestGrant[];
  readonly activeWorkspaceId?: string;
}

/** The whole manager state, readable back after a run. */
export interface TestCredentialManagerState {
  readonly identity: Identity | undefined;
  readonly grants: readonly TestGrant[];
  readonly activeWorkspaceId: string | null;
}

/** Mints an unsigned JWT whose payload is exactly `claims` — the
 *  harness's claim source for beginSession derivation (`sub`,
 *  `workspace_id`, `exp`, `email`). */
export function mintTestJwt(claims: Readonly<Record<string, unknown>>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.test-signature`;
}

function decodeJwtClaims(
  token: string,
): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringClaim(
  claims: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = claims[key];
  return typeof value === "string" ? value : undefined;
}

interface DerivedClaims {
  readonly identity: Identity;
  readonly workspaceId: string;
  readonly expiresAt: Date | undefined;
}

function deriveFromClaims(credential: Credential): DerivedClaims {
  const claims = decodeJwtClaims(credential.token);
  const sub = claims === undefined ? undefined : stringClaim(claims, "sub");
  const workspaceId =
    claims === undefined ? undefined : stringClaim(claims, "workspace_id");
  if (claims === undefined || sub === undefined || workspaceId === undefined) {
    throw new Error(
      "@prisma/cli-engine/testing: beginSession derives identity and workspace from the credential's claims — the token must be a JWT with `sub` and `workspace_id` (use mintTestJwt)",
    );
  }
  const exp = claims.exp;
  const expiresAt = typeof exp === "number" ? new Date(exp * 1000) : undefined;
  const identity: Identity =
    credential.method === "service-token"
      ? { kind: "service", id: sub, label: undefined }
      : { kind: "user", id: sub, email: stringClaim(claims, "email") };
  return { identity, workspaceId, expiresAt };
}

function identityFromGrants(
  grants: readonly TestGrant[],
): Identity | undefined {
  for (const grant of grants) {
    const claims = decodeJwtClaims(grant.credential.token);
    const sub = claims === undefined ? undefined : stringClaim(claims, "sub");
    if (sub !== undefined) {
      return grant.credential.method === "service-token"
        ? { kind: "service", id: sub, label: undefined }
        : {
            kind: "user",
            id: sub,
            email: claims === undefined ? undefined : stringClaim(claims, "email"),
          };
    }
  }
  return undefined;
}

/**
 * The harness's mutable in-memory CredentialManager: the same
 * interface commands see, with the whole state readable back after a
 * run. No persistence, no locking — those belong to the real manager
 * and its own tests.
 */
export class TestCredentialManager implements CredentialManager {
  private identity: Identity | undefined;
  private heldGrants: TestGrant[];
  private activeWorkspaceId: string | null;
  private environmentSession: Session | undefined;
  private readonly client: ManagementApiClient | undefined;

  constructor(
    seed: TestCredentialManagerSeed,
    client?: ManagementApiClient,
  ) {
    this.client = client;
    this.heldGrants = [...(seed.grants ?? [])];
    this.identity = seed.identity ?? identityFromGrants(this.heldGrants);
    this.activeWorkspaceId = seed.activeWorkspaceId ?? null;
    this.environmentSession =
      seed.session?.origin === "environment" ? seed.session : undefined;
    if (seed.session !== undefined && seed.session.origin === "stored") {
      this.materializeStoredSession(seed.session);
    }
    if (seed.credential !== undefined) {
      this.applyBeginSession(seed.credential);
    }
  }

  state(): TestCredentialManagerState {
    return {
      identity: this.identity,
      grants: [...this.heldGrants],
      activeWorkspaceId: this.activeWorkspaceId,
    };
  }

  async session(): Promise<Session | null> {
    if (this.environmentSession !== undefined) {
      return this.environmentSession;
    }
    return this.storedSession();
  }

  async beginSession(credential: Credential): Promise<Session> {
    return this.applyBeginSession(credential);
  }

  async endSession(): Promise<void> {
    this.refuseUnderEnvironmentSession();
    this.identity = undefined;
    this.heldGrants = [];
    this.activeWorkspaceId = null;
  }

  async grants(): Promise<readonly GrantSummary[]> {
    return this.heldGrants.map((grant) => ({
      workspace: grant.workspace,
      expiresAt: grant.credential.expiresAt,
      active: grant.workspace.id === this.activeWorkspaceId,
    }));
  }

  async rememberWorkspaceName(workspaceId: string, name: string): Promise<void> {
    this.heldGrants = this.heldGrants.map((grant) =>
      grant.workspace.id === workspaceId
        ? { ...grant, workspace: { id: workspaceId, name } }
        : grant,
    );
  }

  async activateGrant(ref: string): Promise<Session> {
    this.refuseUnderEnvironmentSession();
    this.activeWorkspaceId = this.resolveRef(ref).workspace.id;
    const session = this.storedSession();
    if (session === null) {
      throw credentialsRequiredError("grants-held-none-active");
    }
    return session;
  }

  async forgetGrant(ref: string): Promise<void> {
    this.refuseUnderEnvironmentSession();
    const grant = this.resolveRef(ref);
    this.heldGrants = this.heldGrants.filter((held) => held !== grant);
    if (this.activeWorkspaceId === grant.workspace.id) {
      this.activeWorkspaceId = null;
    }
  }

  /** Credential resolution is internal per the interface ruling: only
   *  apiClient() consumes it. */
  private resolveCredential(): Credential | null {
    if (this.environmentSession !== undefined) {
      return {
        token: "test-environment-token",
        refreshToken: undefined,
        expiresAt: this.environmentSession.expiresAt,
        method: this.environmentSession.method,
      };
    }
    const session = this.storedSession();
    if (session === null) {
      return null;
    }
    const active = this.heldGrants.find(
      (grant) => grant.workspace.id === this.activeWorkspaceId,
    );
    return active === undefined ? null : active.credential;
  }

  async apiClient(): Promise<ManagementApiClient> {
    if (this.resolveCredential() === null) {
      throw credentialsRequiredError();
    }
    if (this.client === undefined) {
      throw new Error(
        "@prisma/cli-engine/testing: supply managementApi.client to createTestCli before using apiClient()",
      );
    }
    return this.client;
  }

  /** Shared throw semantics with session(): null when signed out; the
   *  structured grants-held-none-active error when grants are held but
   *  no cursor names one. */
  private storedSession(): Session | null {
    if (this.identity === undefined || this.heldGrants.length === 0) {
      return null;
    }
    const active = this.heldGrants.find(
      (grant) => grant.workspace.id === this.activeWorkspaceId,
    );
    if (active === undefined) {
      throw credentialsRequiredError("grants-held-none-active");
    }
    return {
      identity: this.identity,
      method: active.credential.method,
      origin: "stored",
      workspace: active.workspace,
      expiresAt: active.credential.expiresAt,
    };
  }

  private materializeStoredSession(session: Session): void {
    this.identity = session.identity;
    this.heldGrants = [
      {
        workspace: session.workspace,
        credential: {
          token: "test-session-token",
          refreshToken: undefined,
          expiresAt: session.expiresAt,
          method: session.method,
        },
      },
    ];
    this.activeWorkspaceId = session.workspace.id;
  }

  private applyBeginSession(credential: Credential): Session {
    const derived = deriveFromClaims(credential);
    const sameIdentity =
      this.identity !== undefined && this.identity.id === derived.identity.id;
    if (!sameIdentity) {
      this.heldGrants = [];
    }
    this.identity = derived.identity;
    const existing = this.heldGrants.find(
      (grant) => grant.workspace.id === derived.workspaceId,
    );
    const stored: TestGrant = {
      workspace: { id: derived.workspaceId, name: existing?.workspace.name },
      credential: {
        token: credential.token,
        refreshToken: credential.refreshToken,
        expiresAt: derived.expiresAt,
        method: credential.method,
      },
    };
    this.heldGrants = [
      ...this.heldGrants.filter((grant) => grant.workspace.id !== derived.workspaceId),
      stored,
    ];
    this.activeWorkspaceId = derived.workspaceId;
    return {
      identity: derived.identity,
      method: credential.method,
      origin: "stored",
      workspace: stored.workspace,
      expiresAt: derived.expiresAt,
    };
  }

  private refuseUnderEnvironmentSession(): void {
    if (this.environmentSession !== undefined) {
      throw environmentSessionMutationError({
        envVar: SERVICE_TOKEN_ENV_VAR,
        storedGrantsExist: this.heldGrants.length > 0,
      });
    }
  }

  private resolveRef(ref: string): TestGrant {
    const byId = this.heldGrants.find((grant) => grant.workspace.id === ref);
    if (byId !== undefined) {
      return byId;
    }
    const byName = this.heldGrants.filter(
      (grant) => grant.workspace.name?.toLowerCase() === ref.toLowerCase(),
    );
    if (byName.length > 1) {
      throw new CliStructuredError(
        "AUTH.WORKSPACE_REF_AMBIGUOUS",
        `'${ref}' names more than one held workspace grant.`,
        {
          nextActions: [
            {
              kind: "user-choice",
              label: "Refer to the workspace by its id instead.",
            },
          ],
        },
      );
    }
    if (byName.length === 0) {
      throw new CliStructuredError(
        "AUTH.GRANT_NOT_HELD",
        `You hold no workspace grant matching '${ref}'.`,
        {
          nextActions: [
            {
              kind: "user-choice",
              label: "Sign in to that workspace to acquire a grant for it.",
            },
          ],
        },
      );
    }
    return byName[0];
  }
}
