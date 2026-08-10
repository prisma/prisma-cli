import type { ActiveCredential, CredentialIdentity } from "@prisma/cli-engine";
import { SERVICE_TOKEN_ENV_VAR } from "../../auth";

export interface FieldRow {
  readonly label: string;
  readonly value: string;
}

export const ENVIRONMENT_SESSION_NOTICE = `${SERVICE_TOKEN_ENV_VAR} supplies the session in force; unset it to use your stored workspace sessions.`;

/** The card rows for the active credential, or the signed-out row when
 *  there is none. A credential nothing names — an environment token
 *  whose claims carry no workspace — has no workspace row at all. */
export function credentialFieldRows(spec: {
  readonly credential: ActiveCredential | null;
  readonly identity: CredentialIdentity | null;
}): readonly FieldRow[] {
  const credential = spec.credential;
  if (credential === null) {
    return [{ label: "status", value: "signed out" }];
  }
  const rows: FieldRow[] = [{ label: "status", value: "signed in" }];
  if (spec.identity?.email !== undefined) {
    rows.push({ label: "user", value: spec.identity.email });
  }
  if (credential.workspaceId !== undefined) {
    rows.push({
      label: "workspace",
      value: credential.workspaceName ?? credential.workspaceId,
    });
  }
  if (credential.origin.source === "environment") {
    rows.push({ label: "source", value: SERVICE_TOKEN_ENV_VAR });
  }
  return rows;
}
