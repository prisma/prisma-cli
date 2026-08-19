import {
  type CredentialManager,
  claimedIdentity,
  type Session,
} from "@prisma/cli-engine";
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
    enrichSessions: async (): Promise<AccountStoredSessions> => {
      const stored = await sessions();
      return {
        sessions: stored.sessions.map((session) =>
          withIdentity(session, identities.get(session.workspaceId)),
        ),
        selectedWorkspaceId: stored.selectedWorkspaceId,
      };
    },
    createSession: async (
      ...args: Parameters<CredentialManager["createSession"]>
    ) => {
      const session = await createSession(...args);
      const identity = claimedIdentity(args[0].token);
      identities.set(args[1], identity);
      return withIdentity(session, identity);
    },
    selectSession: async (
      ...args: Parameters<CredentialManager["selectSession"]>
    ) => {
      const session = await selectSession(...args);
      return withIdentity(session, identities.get(session.workspaceId));
    },
  });
}

function withIdentity(
  session: Session,
  identity: ReturnType<typeof claimedIdentity>,
) {
  return { ...session, identity };
}
