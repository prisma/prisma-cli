/**
 * The vendor table is read through the CJS require cache, never as an
 * ES-module JSON import. Under Bun 1.3, a JSON file that enters the ES
 * module registry poisons a later CJS `require` of the same file — it
 * returns the `{__esModule, default}` wrapper instead of the array — and
 * ci-info's own index.js requires its vendors.json. The engine cannot
 * control what else a host process loads, so its built output must use
 * the same cache ci-info does. Found by composer's engine-0.1.0
 * adoption (prisma/composer#234): `vendors.map is not a function` when
 * any config graph reached `import { isCI } from "ci-info"` under bun.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const ESM_JSON_IMPORT = /from\s*["'][^"']*vendors\.json["']/;
const IMPORT_ATTRIBUTE = /with\s*\{\s*type:\s*["']json["']\s*\}/;

describe("the vendor table's loading mechanism", () => {
  test("the built engine never imports vendors.json as an ES module", () => {
    expect(existsSync(DIST), `${DIST} is missing — build first`).toBe(true);
    const files = readdirSync(DIST, {
      recursive: true,
      encoding: "utf8",
    }).filter((name) => name.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(join(DIST, name), "utf8");
      expect(
        ESM_JSON_IMPORT.test(source),
        `${name} imports vendors.json as an ES module`,
      ).toBe(false);
      expect(
        IMPORT_ATTRIBUTE.test(source),
        `${name} carries a JSON import attribute`,
      ).toBe(false);
    }
  });
});
