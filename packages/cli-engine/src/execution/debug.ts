import type { Runtime } from "../runtime";

export type DebugLog = (message: string) => void;

const DEBUG_ENV_VAR = "PRISMA_DEBUG";

/**
 * The engine's debug valve: silent unless PRISMA_DEBUG=1 in the
 * injected env (never process.env), writing to the injected stderr.
 * Token material never reaches it.
 */
export function makeDebugLog(runtime: Runtime): DebugLog {
  if (runtime.env[DEBUG_ENV_VAR] !== "1") return () => {};
  return (message) => {
    runtime.stderr.write(`[cli-engine] ${message}\n`);
  };
}
