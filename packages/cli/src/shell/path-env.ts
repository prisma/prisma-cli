/**
 * Collapses case-variant spellings of `PATH` into the canonical `PATH` key, in
 * place. No-op outside Windows.
 *
 * Windows stores the variable as `Path` and resolves env lookups
 * case-insensitively, so `process.env.PATH` reads it fine — but spreading
 * `process.env` into a plain object drops that case-insensitivity. The compute
 * SDK does exactly that to prepend `node_modules/.bin` for a local build, so
 * its `PATH` read misses the inherited `Path`, truncating it until the spawned
 * build can no longer resolve `bun`/`next`. Normalizing up front keeps the
 * spread correct; the rename is invisible because Windows ignores the casing.
 */
export function canonicalizeWindowsPathKey(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "win32") {
    return;
  }

  const variants = Object.keys(env).filter(
    (key) => key.toUpperCase() === "PATH" && key !== "PATH",
  );
  if (variants.length === 0) {
    return;
  }

  // `env.PATH` resolves the canonical key and, on the real process.env, `Path`
  // too; sort the remaining variants so the fallback never depends on key
  // insertion order.
  const value = env.PATH ?? env[[...variants].sort()[0]];
  for (const variant of variants) {
    delete env[variant];
  }
  // The deletes above also clear the case-insensitive `PATH` on the real
  // process.env, so write the canonical key back.
  if (value !== undefined) {
    env.PATH = value;
  }
}
