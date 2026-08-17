/**
 * Import purity on this package's own published output. The engine's
 * built dist must import only what a consumer of @prisma/cli-engine
 * will have installed — a specifier that is not a declared dependency
 * is an install that resolves nothing.
 *
 * The sibling no-child-process-in-dist.test.ts checks a single forbidden
 * name by substring; this checks the whole declared dependency set with
 * a real module lexer, which is what lets it distinguish an import from
 * a package name that merely appears in the text.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  checkImportPurity,
  type PackageManifest,
} from "@repo/cli-conformance/import-purity";
import { sweepBuiltOutput } from "@repo/cli-conformance/module-graph";
import { describe, expect, test } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));

describe("conformance: import purity", () => {
  test("the built engine imports only what its manifest declares", async () => {
    const output = await sweepBuiltOutput(`${HERE}../dist`);
    const manifest = JSON.parse(
      await readFile(`${HERE}../package.json`, "utf8"),
    ) as PackageManifest;
    expect(
      checkImportPurity({
        label: "@prisma/cli-engine",
        output,
        manifest,
        // ci-info's vendor table is read through createRequire — a CJS
        // require the lexer rightly does not count as an import — so the
        // ES module registry never holds vendors.json and ci-info's own
        // require of it stays sane under Bun (see
        // no-esm-json-import-in-dist.test.ts).
        allowedUnimported: ["ci-info"],
        // Anti-vacuity: a run that swept the wrong directory would
        // otherwise report a clean sweep of nothing.
        requiredSpecifiers: ["@stricli/core"],
      }),
    ).toEqual([]);
  });
});
