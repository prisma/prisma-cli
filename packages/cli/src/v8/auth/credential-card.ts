import {
  type ActiveCredential,
  type CredentialIdentity,
  SERVICE_TOKEN_ENV_VAR,
} from "@prisma/cli-engine";

export interface FieldRow {
  readonly label: string;
  readonly value: string;
}

export const ENVIRONMENT_CREDENTIAL_NOTICE = `${SERVICE_TOKEN_ENV_VAR} supplies the credential in force; unset it to use your stored workspace sessions.`;

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
    // The label is not "source": whoami's json result already spends
    // that word on "stored" | "environment", and this value is the name
    // of a variable the user can unset.
    rows.push({ label: "environment variable", value: SERVICE_TOKEN_ENV_VAR });
  }
  return rows;
}
