import type { Session } from "@prisma/cli-engine";
import { SERVICE_TOKEN_ENV_VAR } from "../../auth";
import { sessionLabel } from "./session-ref";

export interface FieldRow {
  readonly label: string;
  readonly value: string;
}

/** The identity a session's own claims or the API can supply. */
export interface SessionIdentity {
  readonly id: string | null;
  readonly email: string | null;
  readonly name: string | null;
}

export const ENVIRONMENT_SESSION_NOTICE = `${SERVICE_TOKEN_ENV_VAR} supplies the session in force; unset it to use your stored workspace sessions.`;

/** The card rows for a session, or the signed-out row when there is
 *  none. */
export function sessionFieldRows(spec: {
  readonly session: Session | null;
  readonly identity: SessionIdentity | null;
}): readonly FieldRow[] {
  const session = spec.session;
  if (session === null) {
    return [{ label: "status", value: "signed out" }];
  }
  const rows: FieldRow[] = [{ label: "status", value: "signed in" }];
  const user = spec.identity?.email ?? spec.identity?.name;
  if (user) {
    rows.push({ label: "user", value: user });
  }
  rows.push({ label: "workspace", value: sessionLabel(session) });
  if (session.source === "environment") {
    rows.push({ label: "source", value: SERVICE_TOKEN_ENV_VAR });
  }
  return rows;
}
