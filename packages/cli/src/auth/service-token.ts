import {
  emptyServiceTokenError,
  SERVICE_TOKEN_ENV_VAR,
} from "@prisma/cli-engine";

/**
 * The env-supplied service token, trimmed — or undefined when the var
 * is not set. A blank or whitespace value is never "not set" and never
 * an override: it raises the single blank-token error, identically
 * everywhere the environment credential would be consulted.
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

/** Whether the environment credential is the one this process
 *  authenticates as. It does not change stored state (design §11.7) —
 *  this is a display fact. Blank raises. */
export function environmentCredentialInForce(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return environmentServiceToken(env) !== undefined;
}
