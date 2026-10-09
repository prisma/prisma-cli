import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SUPPORTED_NODE_RANGE = "^22.18.0 || ^24.11.0 || >=26.0.0";
// Changing the engine's manifest requires a new engine version, which the
// product CLIs then have to peer before the shell can ship it. The engine
// takes the range with its next real change; delete this entry then.
const RANGE_BEFORE_NEXT_ENGINE_RELEASE = {
  "@prisma/cli-engine": ">=22.12.0",
};
const packagesDir = join(import.meta.dirname, "..", "packages");

const runtimePackages = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) =>
    JSON.parse(
      readFileSync(join(packagesDir, entry.name, "package.json"), "utf8"),
    ),
  )
  .filter((manifest) => manifest.engines !== undefined);

describe("engines.node", () => {
  it("covers every package that ships runtime code", () => {
    assert.deepEqual(runtimePackages.map((manifest) => manifest.name).sort(), [
      "@prisma/cli",
      "@prisma/cli-engine",
      "@prisma/compute",
      "@repo/cli-conformance",
      "@repo/cli-telemetry",
      "prisma",
    ]);
  });

  for (const manifest of runtimePackages) {
    it(`is the supported range in ${manifest.name}`, () => {
      assert.equal(
        manifest.engines.node,
        RANGE_BEFORE_NEXT_ENGINE_RELEASE[manifest.name] ?? SUPPORTED_NODE_RANGE,
      );
    });
  }
});
