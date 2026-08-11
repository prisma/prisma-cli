/**
 * The spawn boundary, enforced: the engine hands the terminal to
 * children only through the Runtime.spawn seam, so its BUILT output
 * must never reference child_process. The test tree may (the
 * real-child suite and its host fixture legitimately spawn); source
 * must not, and dist is where that is checkable after bundling.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));

describe("the spawn boundary", () => {
  test("the built engine output contains no child_process specifier", () => {
    expect(existsSync(DIST), `${DIST} is missing — build first`).toBe(true);
    // Recursive: the build emits several flat entry points today, but a
    // shared chunk in a subdirectory must not escape the check.
    const files = readdirSync(DIST, {
      recursive: true,
      encoding: "utf8",
    }).filter((name) => name.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(
        readFileSync(join(DIST, name), "utf8").includes("child_process"),
        `${name} references child_process`,
      ).toBe(false);
    }
  });
});
