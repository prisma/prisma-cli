import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeOverrides, declaredBins } from "./tarball-smoke-utils.mjs";

const NEVER_PACKED = /never packed/;
const MUST_BE_ABSOLUTE = /absolute/;

function workspace(entries) {
  return new Map(Object.entries(entries));
}

describe("computeOverrides", () => {
  it("maps a workspace dependency to a version-qualified file: override", () => {
    const overrides = computeOverrides(
      { name: "@prisma/cli", dependencies: { "@prisma/cli-engine": "8.0.0" } },
      workspace({
        "@prisma/cli-engine": {
          manifest: { name: "@prisma/cli-engine", version: "8.0.0" },
          tarballPath: "/packed/engine.tgz",
        },
      }),
    );

    assert.deepEqual(overrides, {
      "@prisma/cli-engine@8.0.0": "file:/packed/engine.tgz",
    });
  });

  it("ignores registry dependencies", () => {
    const overrides = computeOverrides(
      { name: "@prisma/cli", dependencies: { colorette: "^2.0.20" } },
      workspace({}),
    );

    assert.deepEqual(overrides, {});
  });

  it("recurses into a workspace dependency's own workspace dependencies", () => {
    const overrides = computeOverrides(
      { name: "a", dependencies: { b: "1.0.0" } },
      workspace({
        b: {
          manifest: {
            name: "b",
            version: "1.0.0",
            dependencies: { c: "2.0.0" },
          },
          tarballPath: "/packed/b.tgz",
        },
        c: {
          manifest: { name: "c", version: "2.0.0" },
          tarballPath: "/packed/c.tgz",
        },
      }),
    );

    assert.deepEqual(overrides, {
      "b@1.0.0": "file:/packed/b.tgz",
      "c@2.0.0": "file:/packed/c.tgz",
    });
  });

  it("survives a dependency cycle between workspace packages", () => {
    const overrides = computeOverrides(
      { name: "a", dependencies: { b: "1.0.0" } },
      workspace({
        b: {
          manifest: {
            name: "b",
            version: "1.0.0",
            dependencies: { b: "1.0.0" },
          },
          tarballPath: "/packed/b.tgz",
        },
      }),
    );

    assert.deepEqual(overrides, { "b@1.0.0": "file:/packed/b.tgz" });
  });

  it("refuses a workspace dependency that was never packed", () => {
    assert.throws(
      () =>
        computeOverrides(
          { name: "a", dependencies: { b: "1.0.0" } },
          workspace({
            b: {
              manifest: { name: "b", version: "1.0.0" },
              tarballPath: undefined,
            },
          }),
        ),
      NEVER_PACKED,
    );
  });

  it("refuses a relative tarball path", () => {
    assert.throws(
      () =>
        computeOverrides(
          { name: "a", dependencies: { b: "1.0.0" } },
          workspace({
            b: {
              manifest: { name: "b", version: "1.0.0" },
              tarballPath: "packed/b.tgz",
            },
          }),
        ),
      MUST_BE_ABSOLUTE,
    );
  });
});

describe("declaredBins", () => {
  it("reads the bin map", () => {
    assert.deepEqual(
      declaredBins({
        name: "@prisma/cli",
        bin: { "prisma-cli": "./dist/v8/cli.js" },
      }),
      [{ name: "prisma-cli", path: "./dist/v8/cli.js" }],
    );
  });

  it("treats a string bin as named after the unscoped package", () => {
    assert.deepEqual(declaredBins({ name: "@scope/tool", bin: "./run.js" }), [
      { name: "tool", path: "./run.js" },
    ]);
  });

  it("returns nothing for a package without bins", () => {
    assert.deepEqual(declaredBins({ name: "@prisma/cli-engine" }), []);
  });
});
