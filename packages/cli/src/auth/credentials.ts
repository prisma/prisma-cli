import type { Credentials } from "@prisma/cli-engine";
import { SERVICE_TOKEN_ENV_VAR } from "./client";
import { EmptyServiceTokenError } from "./operations";
import { FileTokenStorage } from "./token-storage";

/** Token reads ignore the run's abort signal so they still work during
 *  teardown after the first Ctrl-C. */
export function makeGetCredentials(
  env: NodeJS.ProcessEnv,
): () => Promise<Credentials | undefined> {
  return async () => {
    const rawServiceToken = env[SERVICE_TOKEN_ENV_VAR];
    if (rawServiceToken !== undefined) {
      const serviceToken = rawServiceToken.trim();
      if (serviceToken.length === 0) {
        throw new EmptyServiceTokenError();
      }
      return { token: serviceToken };
    }
    const tokens = await new FileTokenStorage(env).getTokens();
    return tokens ? { token: tokens.accessToken } : undefined;
  };
}
