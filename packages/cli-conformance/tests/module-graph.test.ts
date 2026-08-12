/**
 * The parser under every check that reads built output. The cases that
 * matter are the ones a substring search gets wrong: a package name
 * inside `import.meta.resolve` or a template literal is not an import,
 * and the shipped shell contains exactly that (see
 * packages/cli/src/v8/runtime.ts's sender-path fallback).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { bareImportRoots, sweepBuiltOutput } from "../src/module-graph";

const FIXTURES = join(
  fileURLToPath(new URL("./fixtures", import.meta.url)),
  "built-output",
);

async function roots(source: string): Promise<string[]> {
  return [
    ...new Set((await bareImportRoots(source, "probe.js")).map((r) => r.root)),
  ].sort();
}

describe("bareImportRoots", () => {
  test("reads a static import and a re-export", async () => {
    expect(
      await roots(`import "pkg-a";\nexport { b } from "pkg-b";\n`),
    ).toEqual(["pkg-a", "pkg-b"]);
  });

  test("reads a dynamic import", async () => {
    expect(await roots(`await import("pkg-c");\n`)).toEqual(["pkg-c"]);
  });

  test("reduces a deep subpath to its package root", async () => {
    expect(await roots(`import "pkg-d/sub/thing";\n`)).toEqual(["pkg-d"]);
  });

  test("keeps both segments of a scoped name and drops the subpath", async () => {
    expect(await roots(`import "@scope/pkg-e/sub";\n`)).toEqual([
      "@scope/pkg-e",
    ]);
  });

  test("ignores relative and absolute specifiers", async () => {
    expect(await roots(`import "./rel.js";\nimport "/abs.js";\n`)).toEqual([]);
  });

  test("ignores node builtins written either way", async () => {
    expect(await roots(`import "node:fs";\nimport "path";\n`)).toEqual([]);
  });

  /** The case that decides the whole approach. */
  test("does not treat import.meta.resolve or a template literal as an import", async () => {
    const source = [
      'const a = import.meta.resolve("@repo/private");',
      "const b = `@repo/private/sender`;",
      'const c = "@repo/private";',
      "export { a, b, c };",
      "",
    ].join("\n");
    expect(await roots(source)).toEqual([]);
  });

  test("reports the full specifier alongside the root", async () => {
    expect(await bareImportRoots(`import "pkg-d/sub";\n`, "probe.js")).toEqual([
      { root: "pkg-d", specifier: "pkg-d/sub", file: "probe.js" },
    ]);
  });
});

describe("sweepBuiltOutput", () => {
  test("finds a chunk nested in a subdirectory, not just the top level", async () => {
    const swept = await sweepBuiltOutput(FIXTURES);
    expect([...swept.files].sort()).toEqual([
      "entry.js",
      join("nested", "chunk.js"),
    ]);
    expect([...new Set(swept.imports.map((i) => i.root))].sort()).toEqual([
      "pkg-nested",
      "pkg-top",
    ]);
  });

  test("an empty or missing directory sweeps no files, which callers must treat as a finding", async () => {
    const swept = await sweepBuiltOutput(join(FIXTURES, "does-not-exist"));
    expect(swept.files).toEqual([]);
  });
});
