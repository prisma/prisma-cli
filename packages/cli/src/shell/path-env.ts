/**
 * Collapses case-variant spellings of the `PATH` environment variable into
 * the canonical `PATH` key, in place. No-op outside Windows.
 *
 * Windows typically keys the variable as `Path` (its registry casing), and
 * `process.env` papers over that with case-insensitive lookups. Anything that
 * spreads `process.env` into a plain object — the compute SDK does this when
 * it prepends `node_modules/.bin` directories for a local build — loses that
 * case-insensitivity: reading `env.PATH` returns undefined, so the rewritten
 * PATH drops every inherited entry, and writing `env.PATH` forks a second key
 * alongside `Path`. The child's environment block is case-insensitive again,
 * so the truncated `PATH` clobbers the real `Path` and the spawned build
 * cannot resolve commands like `bun` ("'bun' is not recognized ...").
 *
 * Windows itself resolves environment variables case-insensitively, so
 * renaming the key to `PATH` is invisible to this process and its children.
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

  // On the real Windows process.env, `env.PATH` already resolves the `Path`
  // entry case-insensitively; a plain-object copy needs the variant lookup.
  const value = env.PATH ?? env[variants[0]];
  for (const variant of variants) {
    delete env[variant];
  }
  // On process.env the deletes above also remove the case-insensitive `PATH`
  // entry itself, so always write the canonical key back.
  if (value !== undefined) {
    env.PATH = value;
  }
}
