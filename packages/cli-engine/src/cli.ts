import type { CommandFamily, MountedTree } from "./command-family";
import { buildEngine } from "./execution/engine";
import type { Runtime } from "./runtime";

export interface Cli {
  /**
   * Parse, execute, render, return the exit code. Never touches
   * process globals — it exits only through the runtime's exit proxy
   * (second-signal force exit) and writes only to the provided streams.
   */
  run(argv: readonly string[], runtime: Runtime): Promise<number>;
}

/**
 * Shell-side construction. Group help is declared with the mount.
 * Collisions, unknown groups, reserved-flag violations, grammar
 * violations, and foreign-section references fail construction (build
 * time, not run time).
 */
export function createCli(spec: {
  readonly name: string;
  readonly version: string;
  readonly commandFamilies: readonly CommandFamily[];
  readonly groups: Readonly<
    Record<string, { readonly brief: string; readonly description?: string }>
  >;
  readonly commands: MountedTree;
}): Cli {
  const engine = buildEngine(spec);
  return {
    run: (argv, runtime) => engine.execute(argv, runtime, {}),
  };
}
