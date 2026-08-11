import fs from "node:fs/promises";
import { claimedExpiresAt, credentialWorkspaceId } from "@prisma/cli-engine";
import type { CredentialState, StoredSession } from "./state-file";
import { getAuthContextFilePath } from "./token-storage";

const LEGACY_PLACEHOLDER_NAME = "Unknown workspace";

interface LegacyContext {
  readonly exists: boolean;
  readonly activeWorkspaceId: string | null;
  readonly names: Readonly<Record<string, string | undefined>>;
}

/**
 * The legacy store read as sessions. Pure: adoption never writes, and
 * the legacy files stay untouched until a mutation materializes the
 * adopted set in the new format.
 */
export async function adoptLegacyState(
  parsedAuthFile: unknown,
  authFilePath: string,
): Promise<CredentialState> {
  const entries = (parsedAuthFile as { tokens?: unknown }).tokens;
  if (!Array.isArray(entries)) {
    return { version: 1, sessions: [], currentWorkspaceId: null };
  }

  const context = await readLegacyContext(getAuthContextFilePath(authFilePath));
  const adopted = new Map<string, StoredSession>();
  for (const entry of entries) {
    const session = adoptLegacyEntry(entry, context);
    if (session) adopted.set(session.workspaceId, session);
  }

  const sessions = [...adopted.values()];
  return {
    version: 1,
    sessions,
    currentWorkspaceId: adoptedCurrent(sessions, context),
  };
}

function adoptLegacyEntry(
  entry: unknown,
  context: LegacyContext,
): StoredSession | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const { token, refreshToken } = entry as {
    token?: unknown;
    refreshToken?: unknown;
  };
  if (typeof token !== "string" || token.length === 0) return undefined;

  const workspaceId = credentialWorkspaceId(token);
  if (workspaceId === undefined) return undefined;

  const name = adoptedName(context.names[workspaceId], workspaceId);
  const expiresAt = claimedExpiresAt(token);
  return {
    workspaceId,
    ...(name === undefined ? {} : { name }),
    token,
    ...(typeof refreshToken === "string" && refreshToken.length > 0
      ? { refreshToken }
      : {}),
    ...(expiresAt === undefined ? {} : { expiresAt: expiresAt.toISOString() }),
  };
}

/** Legacy placeholders do not adopt: a name equal to "Unknown
 *  workspace" or to the workspace id adopts as no name at all. */
function adoptedName(
  name: string | undefined,
  workspaceId: string,
): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  if (trimmed === LEGACY_PLACEHOLDER_NAME) return undefined;
  if (trimmed === workspaceId) return undefined;
  return trimmed;
}

function adoptedCurrent(
  sessions: readonly StoredSession[],
  context: LegacyContext,
): string | null {
  if (context.exists) {
    const pointed = context.activeWorkspaceId;
    return pointed !== null &&
      sessions.some((session) => session.workspaceId === pointed)
      ? pointed
      : null;
  }
  return sessions.length === 1 ? sessions[0].workspaceId : null;
}

async function readLegacyContext(
  contextFilePath: string,
): Promise<LegacyContext> {
  const absent: LegacyContext = {
    exists: false,
    activeWorkspaceId: null,
    names: {},
  };

  const raw = await fs.readFile(contextFilePath, "utf8").catch(() => null);
  if (raw === null) return absent;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return absent;
  }
  if (typeof parsed !== "object" || parsed === null) return absent;

  const { activeWorkspaceId, workspaces } = parsed as {
    activeWorkspaceId?: unknown;
    workspaces?: unknown;
  };
  const names: Record<string, string | undefined> = {};
  if (
    typeof workspaces === "object" &&
    workspaces !== null &&
    !Array.isArray(workspaces)
  ) {
    for (const [workspaceId, value] of Object.entries(workspaces)) {
      const name = (value as { name?: unknown } | null)?.name;
      if (typeof name === "string") names[workspaceId] = name;
    }
  }

  return {
    exists: true,
    activeWorkspaceId:
      typeof activeWorkspaceId === "string" && activeWorkspaceId.trim()
        ? activeWorkspaceId.trim()
        : null,
    names,
  };
}
