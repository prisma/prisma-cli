import { emptyServiceTokenError } from "@prisma/cli-engine";
import { SERVICE_TOKEN_ENV_VAR } from "./client";

/**
 * The env-supplied service token, trimmed — or undefined when the var
 * is not set. A blank or whitespace value is never "not set" and never
 * an override: it raises the single blank-token error, identically
 * everywhere the env session would be consulted.
 */
export function environmentServiceToken(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const raw = env[SERVICE_TOKEN_ENV_VAR];
  if (raw === undefined) return undefined;
  if (raw.trim().length === 0) {
    throw emptyServiceTokenError({ envVar: SERVICE_TOKEN_ENV_VAR });
  }
  return raw.trim();
}

/** Whether the env session overrides the stored ones. Blank raises. */
export function environmentSessionInForce(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return environmentServiceToken(env) !== undefined;
}
