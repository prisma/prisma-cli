import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export interface ResolvedPackage {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  /** The directory resolution started from — the project root, or a
   *  workspace member that pins its own copy. */
  readonly resolvedFrom: string;
}

/**
 * Standard module resolution of one named package from one directory.
 * Under Yarn PnP this goes through the PnP resolver and answers a path
 * inside a zip, which the patched filesystem reads like any other.
 */
export async function resolvePackage(
  fromDir: string,
  packageName: string,
): Promise<ResolvedPackage | null> {
  const dir = resolvePackageDir(fromDir, packageName);
  if (dir === null) {
    return null;
  }

  const version = await readPackageVersion(path.join(dir, "package.json"));
  return version === null
    ? null
    : { name: packageName, version, dir, resolvedFrom: fromDir };
}

function resolvePackageDir(
  fromDir: string,
  packageName: string,
): string | null {
  const requireFrom = createRequire(path.join(fromDir, "package.json"));

  try {
    return path.dirname(requireFrom.resolve(`${packageName}/package.json`));
  } catch {
    // A package whose exports map does not publish ./package.json still
    // resolves through its entry point.
  }

  try {
    return packageRootOf(requireFrom.resolve(packageName), packageName);
  } catch {
    return null;
  }
}

/** Walks up from a resolved entry point to the directory named by the
 *  package specifier — the last `node_modules/<name>` segment on the
 *  path, or the first ancestor holding a package.json with that name. */
function packageRootOf(entry: string, packageName: string): string | null {
  const marker = `${path.sep}node_modules${path.sep}${packageName.split("/").join(path.sep)}`;
  const at = entry.lastIndexOf(marker);
  if (at !== -1) {
    return entry.slice(0, at + marker.length);
  }

  let dir = path.dirname(entry);
  for (;;) {
    if (path.basename(dir) === path.basename(packageName)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

async function readPackageVersion(
  manifestPath: string,
): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      version?: unknown;
    };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}
