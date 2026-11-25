/**
 * `prisma project env` is deprecated, and removing it must mean deleting its
 * files only. So nothing `prisma project variable` loads, directly or through
 * another module, may be an env module. The check follows every relative
 * import from the variable command and library files, using the TypeScript
 * parser so multi-line and type-only imports count too.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../src");
const VARIABLE_DIRS = [
  path.join(SRC, "commands/project/variable"),
  path.join(SRC, "lib/variable"),
];
const ENV_MODULES = [
  /^commands\/project\/env-[^/]+\.ts$/,
  /^controllers\/app-env[^/]*\.ts$/,
  /^lib\/app\/env-[^/]+\.ts$/,
  /^presenters\/app-env\.ts$/,
  /^types\/app-env\.ts$/,
];

function resolveImport(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier);
  return [`${base}.ts`, path.join(base, "index.ts")].find((candidate) =>
    existsSync(candidate),
  );
}

async function importChains(roots: string[]): Promise<Map<string, string[]>> {
  const chains = new Map<string, string[]>(roots.map((root) => [root, [root]]));
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    // biome-ignore lint/performance/noAwaitInLoops: the walk discovers files as it reads them.
    const text = await readFile(file, "utf8");
    for (const { fileName } of ts.preProcessFile(text, true, true)
      .importedFiles) {
      if (!fileName.startsWith(".")) {
        continue;
      }
      const target = resolveImport(file, fileName);
      if (target !== undefined && !chains.has(target)) {
        chains.set(target, [...(chains.get(file) ?? []), target]);
        queue.push(target);
      }
    }
  }
  return chains;
}

describe("prisma project variable", () => {
  it("does not load any prisma project env module", async () => {
    const roots = (
      await Promise.all(
        VARIABLE_DIRS.map(async (dir) =>
          (
            await readdir(dir)
          )
            .filter((name) => name.endsWith(".ts"))
            .map((name) => path.join(dir, name)),
        ),
      )
    ).flat();
    expect(roots.length).toBeGreaterThan(0);

    const offending = [...(await importChains(roots)).entries()]
      .filter(([file]) =>
        ENV_MODULES.some((pattern) =>
          pattern.test(path.relative(SRC, file).split(path.sep).join("/")),
        ),
      )
      .map(([, chain]) =>
        chain.map((file) => path.relative(SRC, file)).join(" -> "),
      );

    expect(offending).toEqual([]);
  });
});
