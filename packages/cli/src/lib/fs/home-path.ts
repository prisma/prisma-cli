import path from "node:path";

/**
 * Shortens a path under the user's home directory to `~/...` for display,
 * posix-style on every platform. Falls back to the Windows home variables
 * when `HOME` is unset (native cmd/PowerShell sessions).
 */
export function shortenHomePath(value: string, env: NodeJS.ProcessEnv): string {
  const resolved = path.resolve(value);
  const home = resolveHomeDirectory(env);

  if (
    home &&
    (resolved === home || resolved.startsWith(`${home}${path.sep}`))
  ) {
    const relative = path.relative(home, resolved).split(path.sep).join("/");
    return relative ? `~/${relative}` : "~";
  }

  return resolved;
}

function resolveHomeDirectory(env: NodeJS.ProcessEnv): string | null {
  if (env.HOME) {
    return path.resolve(env.HOME);
  }

  if (env.USERPROFILE) {
    return path.resolve(env.USERPROFILE);
  }

  if (env.HOMEDRIVE && env.HOMEPATH) {
    return path.resolve(`${env.HOMEDRIVE}${env.HOMEPATH}`);
  }

  return null;
}
