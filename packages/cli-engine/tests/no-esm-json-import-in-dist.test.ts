/**
 * The vendor table is inlined at build time (src/ci.ts): built output
 * that loads ci-info's CJS-owned vendors.json as ESM breaks any host
 * that also requires ci-info (Bun's dual registry; composer#234).
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
