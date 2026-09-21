/**
 * The directory relative paths in a config file resolve against: the
 * directory of the file being evaluated. The loader publishes it in a slot on
 * globalThis around the evaluation, and a family's config helper reads it
 * while the file runs to resolve its own paths. `Symbol.for` so every loader
 * and helper in a dependency tree shares one slot, and a family declares it
 * without importing the engine.
 */
export const BASE_DIR_KEY: unique symbol = Symbol.for("prisma.config.baseDir");

type BaseDirSlot = { [BASE_DIR_KEY]?: string };

/** The published base directory, or undefined outside a loader's evaluation. */
export function baseDir(): string | undefined {
  return (globalThis as BaseDirSlot)[BASE_DIR_KEY];
}

/**
 * Runs `evaluate` with `dir` published as the base directory and restores the
 * previous value after, whether or not the evaluation throws. Evaluations are
 * awaited one at a time; concurrent loads in one process would need the slot
 * moved to an AsyncLocalStorage behind these same two functions.
 */
export async function withBaseDir<T>(
  dir: string,
  evaluate: () => Promise<T>,
): Promise<T> {
  const slot = globalThis as BaseDirSlot;
  const previous = slot[BASE_DIR_KEY];
  slot[BASE_DIR_KEY] = dir;
  try {
    return await evaluate();
  } finally {
    if (previous === undefined) {
      delete slot[BASE_DIR_KEY];
    } else {
      slot[BASE_DIR_KEY] = previous;
    }
  }
}
