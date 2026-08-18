import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { claimedExpiresAt, credentialWorkspaceId } from "@prisma/cli-engine";
import type { CredentialState, StoredSession } from "./state-file";
import { getAuthContextFilePath } from "./token-storage";

const LEGACY_PLACEHOLDER_NAME = "Unknown workspace";

/**
 * The sessions re-serialized in the legacy store's record shape. The
 * 3.x CLI reads `tokens` from auth.json (`data.tokens || []`, silently
 * empty for any other shape), so a write that dropped the key made
 * every session invisible to `@prisma/cli@latest` on the same machine
 * the moment this CLI first mutated the file (#204). Sessions without
 * a refresh token still mirror; the legacy reader skips them, exactly
 * as it skips its own unrefreshable records.
 */
export function legacyTokensMirror(
  sessions: readonly StoredSession[],
): readonly { workspaceId: string; token: string; refreshToken?: string }[] {
  return sessions.map((session) => ({
    workspaceId: session.workspaceId,
    token: session.token,
    ...(session.refreshToken === undefined
      ? {}
      : { refreshToken: session.refreshToken }),
  }));
}

/**
 * Keeps auth.context.json's `activeWorkspaceId` — the pointer the 3.x
 * CLI selects its session with — in step with `currentWorkspaceId`.
 * The rest of the context file (the remembered-workspace name map) is
 * preserved verbatim; only the pointer moves.
 */
export async function syncLegacyContext(
  authFilePath: string,
  currentWorkspaceId: string | null,
): Promise<void> {
  const contextFilePath = getAuthContextFilePath(authFilePath);
  const context = await readLegacyContext(contextFilePath);
  if (context.exists && context.activeWorkspaceId === currentWorkspaceId) {
    return;
  }
  // No file and nothing selected stays no file: an existing context
  // with a null pointer reads as "explicitly signed out" to the 3.x
  // CLI, where an absent one lets it self-activate its latest session.
  if (!context.exists && currentWorkspaceId === null) {
    return;
  }
  const raw = await fs.readFile(contextFilePath, "utf8").catch(() => null);
  let workspaces: unknown = {};
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as { workspaces?: unknown };
      if (
        typeof parsed.workspaces === "object" &&
        parsed.workspaces !== null &&
        !Array.isArray(parsed.workspaces)
      ) {
        workspaces = parsed.workspaces;
      }
    } catch {
      // A corrupt context file is replaced with a fresh one.
    }
  }
  // Temp + rename like the auth file itself: a torn context file makes
  // the 3.x CLI silently self-activate its latest session.
  const tempPath = `${contextFilePath}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify({ activeWorkspaceId: currentWorkspaceId, workspaces }, null, 2)}\n`;
  try {
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, contextFilePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

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
