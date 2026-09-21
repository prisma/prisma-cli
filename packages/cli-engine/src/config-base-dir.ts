import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The directory relative paths in a config file resolve against: the
 * directory of the file being evaluated. The loader publishes it for the
 * duration of the evaluation, and a family's config helper reads it while the
 * file runs to resolve its own paths. The store lives on globalThis under a
 * `Symbol.for` key so every loader and helper in a dependency tree shares
 * one, and a family reads it without importing the engine or
 * node:async_hooks. It is an AsyncLocalStorage rather than a plain value so
 * evaluations that overlap in time, such as a language server loading several
 * projects at once, each see their own directory.
 */
export const BASE_DIR_KEY: unique symbol = Symbol.for("prisma.config.baseDir");

type BaseDirSlot = { [BASE_DIR_KEY]?: AsyncLocalStorage<string> };

/** The published base directory, or undefined when no loader has published one. */
export function baseDir(): string | undefined {
  return (globalThis as BaseDirSlot)[BASE_DIR_KEY]?.getStore();
}

/** Runs `evaluate` with `dir` published as the base directory for everything it awaits. */
export function withBaseDir<T>(
  dir: string,
  evaluate: () => Promise<T>,
): Promise<T> {
  const slot = globalThis as BaseDirSlot;
  slot[BASE_DIR_KEY] ??= new AsyncLocalStorage<string>();
  return slot[BASE_DIR_KEY].run(dir, evaluate);
}
