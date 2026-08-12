import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { init, parse } from "es-module-lexer";

/** One bare specifier a built file imports, and the package it names. */
export interface ImportedSpecifier {
  readonly root: string;
  readonly specifier: string;
  readonly file: string;
}

/** Every built file swept, and every bare specifier they import. */
export interface BuiltOutput {
  readonly files: readonly string[];
  readonly imports: readonly ImportedSpecifier[];
}

const BUILTINS = new Set(builtinModules);

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
function packageRoot(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? specifier);
}

function isBare(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return false;
  if (specifier.startsWith("node:")) return false;
  return !BUILTINS.has(packageRoot(specifier));
}

/**
 * The bare specifiers `source` imports — static imports, re-exports and
 * dynamic `import()`. A package name that merely appears in the text,
 * in a string or inside `import.meta.resolve`, is not an import and is
 * not reported: that distinction is the whole reason this is a lexer
 * and not a search, because the shipped shell contains such a name on
 * purpose.
 */
export async function bareImportRoots(
  source: string,
  file: string,
): Promise<readonly ImportedSpecifier[]> {
  await init;
  const [imports] = parse(source, file);
  const found: ImportedSpecifier[] = [];
  for (const record of imports) {
    // Absent for a dynamic import whose specifier is not a plain string;
    // there is no package name to attribute, so there is nothing to check.
    const specifier = record.n;
    if (specifier === undefined || !isBare(specifier)) continue;
    found.push({ root: packageRoot(specifier), specifier, file });
  }
  return found;
}

/**
 * Every `.js`/`.mjs` file under `distDir`, recursively, and what they
 * import. A missing directory sweeps nothing rather than throwing —
 * callers report the empty result as a finding, because a check that
 * swept nothing has proved nothing.
 */
export async function sweepBuiltOutput(distDir: string): Promise<BuiltOutput> {
  let entries: string[];
  try {
    entries = (await readdir(distDir, { recursive: true })).filter(
      (name) => name.endsWith(".js") || name.endsWith(".mjs"),
    );
  } catch {
    return { files: [], imports: [] };
  }
  const reads = entries.map(async (name) =>
    bareImportRoots(await readFile(join(distDir, name), "utf8"), name),
  );
  return {
    files: entries,
    imports: (await Promise.all(reads)).flat(),
  };
}
