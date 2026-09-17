import { type CredentialManager, claimedIdentity } from "@prisma/cli-engine";
import type { SessionRecord } from "@prisma/cli-engine/testing";

import type { AccountStoredSessions } from "../../src/auth/credential-manager";

/** The engine test manager deliberately models only the shared session
 *  contract. CLI auth tests add this package-local display capability to match
 *  FileCredentialManager without expanding the published engine API. */
export function attachAccountMetadata(
  manager: CredentialManager,
  records: readonly SessionRecord[],
): void {
  const identities = new Map(
    records.map((record) => [
      record.workspaceId,
      claimedIdentity(record.credential.token),
    ]),
  );
  const sessions = manager.sessions.bind(manager);
  const createSession = manager.createSession.bind(manager);
  const selectSession = manager.selectSession.bind(manager);

  Object.assign(manager, {
    sessions: async (): Promise<AccountStoredSessions> => {
      const stored = await sessions();
      return {
        sessions: stored.sessions.map((session) => ({
          ...session,
          identity: identities.get(session.workspaceId),
        })),
        selectedWorkspaceId: stored.selectedWorkspaceId,
      };
    },
    createSession: async (
      ...args: Parameters<CredentialManager["createSession"]>
    ) => {
      const session = await createSession(...args);
      const identity = claimedIdentity(args[0].token);
      identities.set(args[1], identity);
      return { ...session, identity };
    },
    selectSession: async (
      ...args: Parameters<CredentialManager["selectSession"]>
    ) => {
      const session = await selectSession(...args);
      return { ...session, identity: identities.get(session.workspaceId) };
    },
  });
}
