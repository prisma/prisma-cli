import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeVersionUpdates } from "./update-product-versions.mjs";

describe("computeVersionUpdates", () => {
  it("updates a watched dependency whose registry version moved", () => {
    const changes = computeVersionUpdates(
      { dependencies: { "@prisma/composer": "0.6.0-dev.16", left: "1.0.0" } },
      new Map([["@prisma/composer", "0.7.0"]]),
    );
    assert.deepEqual(changes, [
      { name: "@prisma/composer", from: "0.6.0-dev.16", to: "0.7.0" },
    ]);
  });

  it("skips watched packages the shell does not depend on — candidates, not requirements", () => {
    const changes = computeVersionUpdates(
      { dependencies: { "@prisma/composer": "0.6.0-dev.16" } },
      new Map([
        ["@prisma/composer", "0.6.0-dev.16"],
        ["@prisma/composer-cli", "0.7.0"],
      ]),
    );
    assert.deepEqual(changes, []);
  });

  it("skips a package the registry has never seen at its watched tag", () => {
    const changes = computeVersionUpdates(
      { dependencies: { "@prisma/orm-toolchain": "8.0.0-rc.1-dev.40" } },
      new Map([["@prisma/orm-toolchain", undefined]]),
    );
    assert.deepEqual(changes, []);
  });

  it("reports every drifted pin in one run", () => {
    const changes = computeVersionUpdates(
      {
        dependencies: {
          "@prisma/composer": "0.6.0",
          "@prisma/orm-toolchain": "8.0.0-rc.1",
        },
      },
      new Map([
        ["@prisma/composer", "0.7.0"],
        ["@prisma/orm-toolchain", "8.0.0-rc.2"],
      ]),
    );
    assert.equal(changes.length, 2);
  });
});
