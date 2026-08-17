import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeNextEngineVersion } from "./bump-cli-engine-version-utils.ts";

const MUST_MOVE_FORWARD = /forward/;

describe("computeNextEngineVersion", () => {
  it("bumps the minor for `minor`, zeroing the patch — the pre-1.0 breaking bump", () => {
    assert.equal(computeNextEngineVersion("0.1.0", "minor"), "0.2.0");
    assert.equal(computeNextEngineVersion("0.2.3", "minor"), "0.3.0");
  });

  it("bumps the patch for `patch` — the pre-1.0 compatible bump", () => {
    assert.equal(computeNextEngineVersion("0.1.0", "patch"), "0.1.1");
    assert.equal(computeNextEngineVersion("0.2.3", "patch"), "0.2.4");
  });

  it("accepts an explicit version that moves forward", () => {
    assert.equal(computeNextEngineVersion("0.1.0", "0.5.0"), "0.5.0");
    assert.equal(computeNextEngineVersion("0.1.0", "1.0.0"), "1.0.0");
  });

  it("refuses an explicit version that goes backward or nowhere — npm versions are immutable", () => {
    assert.throws(
      () => computeNextEngineVersion("0.1.0", "0.1.0"),
      MUST_MOVE_FORWARD,
    );
    assert.throws(
      () => computeNextEngineVersion("0.2.0", "0.1.9"),
      MUST_MOVE_FORWARD,
    );
  });

  it("refuses anything that is not patch, minor, or an exact X.Y.Z", () => {
    assert.throws(() => computeNextEngineVersion("0.1.0", "major"));
    assert.throws(() => computeNextEngineVersion("0.1.0", "^0.2.0"));
    assert.throws(() => computeNextEngineVersion("0.1.0", "0.2.0-rc.1"));
    assert.throws(() => computeNextEngineVersion("0.1.0", ""));
  });

  it("refuses a current version that is not an exact X.Y.Z — the engine's line has no pre-releases", () => {
    assert.throws(() => computeNextEngineVersion("8.0.0-rc.2", "minor"));
  });
});
