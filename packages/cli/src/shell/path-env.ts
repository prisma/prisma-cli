/**
 * Collapses case-variant spellings of the `PATH` environment variable into
 * the canonical `PATH` key, in place. No-op outside Windows.
 *
 * Windows keys the variable as `Path` (its registry casing) and resolves
 * environment lookups case-insensitively, so `process.env.PATH` works even
 * though the underlying key is `Path`. Code that spreads `process.env` into a
 * plain object loses that case-insensitivity — the compute SDK does exactly
 * this when it prepends `node_modules/.bin` to PATH for a local build, and the
 * result is a truncated PATH that leaves the spawned build unable to resolve
 * `bun`/`next`. Normalizing to `PATH` up front keeps that spread correct.
 * See tests/path-env.test.ts for the reproduced failure mode.
 *
 * Renaming `Path` -> `PATH` is invisible to this process and its children
 * because Windows resolves the lookup case-insensitively either way.
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

  // Precedence when several spellings coexist, so the result never depends on
  // key insertion order: an existing canonical `PATH`, then the Windows-native
  // `Path`, then any remaining variant. On the real process.env, `env.PATH`
  // already reflects the `Path` value case-insensitively.
  const value = env.PATH ?? env.Path ?? env[selectPreferredVariant(variants)];
  for (const variant of variants) {
    delete env[variant];
  }
  // Deleting the variants above also clears the case-insensitive `PATH` entry
  // on the real process.env, so always write the canonical key back.
  if (value !== undefined) {
    env.PATH = value;
  }
}

/** The Windows-native `Path` if present, otherwise the first variant. */
function selectPreferredVariant(variants: string[]): string {
  return variants.includes("Path") ? "Path" : variants[0];
}
