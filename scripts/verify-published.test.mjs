import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNotFoundError, waitForAll } from "./verify-published.mjs";

/** A check that answers false the first `misses` times, then true. */
function resolvesAfter(misses) {
  let seen = 0;
  return () => Promise.resolve(seen++ >= misses);
}

describe("waitForAll", () => {
  it("passes when every spec resolves at once, without waiting", async () => {
    const waits = [];
    const result = await waitForAll(["a@1", "b@1"], {
      check: () => Promise.resolve(true),
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(waits, []);
  });

  /** The registry is eventually consistent; a miss is not a failure. */
  it("keeps waiting while a spec has not appeared yet", async () => {
    let waits = 0;
    const result = await waitForAll(["a@1"], {
      check: resolvesAfter(3),
      sleep: () => {
        waits++;
        return Promise.resolve();
      },
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(waits, 3);
  });

  it("gives up after the attempt limit and names the spec that never appeared", async () => {
    const result = await waitForAll(["a@1", "b@2"], {
      check: (spec) => Promise.resolve(spec === "a@1"),
      sleep: () => Promise.resolve(),
      attempts: 4,
    });
    assert.deepEqual(result, { ok: false, spec: "b@2" });
  });

  it("stops at the first spec that never appears", async () => {
    const checked = [];
    await waitForAll(["a@1", "b@2", "c@3"], {
      check: (spec) => {
        checked.push(spec);
        return Promise.resolve(false);
      },
      sleep: () => Promise.resolve(),
      attempts: 2,
    });
    assert.deepEqual(new Set(checked), new Set(["a@1"]));
  });

  it("does not sleep after the final failed attempt", async () => {
    let waits = 0;
    await waitForAll(["a@1"], {
      check: () => Promise.resolve(false),
      sleep: () => {
        waits++;
        return Promise.resolve();
      },
      attempts: 4,
    });
    assert.equal(waits, 3);
  });

  it("treats no specs as nothing to prove, not as a pass to celebrate", async () => {
    const result = await waitForAll([], {
      check: () => Promise.resolve(false),
      sleep: () => Promise.resolve(),
    });
    assert.deepEqual(result, { ok: true });
  });
});

describe("isNotFoundError", () => {
  it("recognises npm's E404 for a version the registry does not have", () => {
    const error = new Error("Command failed: npm view ...");
    error.stderr = "npm error code E404\nnpm error 404 Not Found";
    assert.equal(isNotFoundError(error), true);
  });

  it("treats a network failure as a real error, not an absent version", () => {
    const error = new Error("Command failed: npm view ...");
    error.stderr = "npm error code ENOTFOUND\nnpm error network request failed";
    assert.equal(isNotFoundError(error), false);
  });

  it("treats a missing npm binary as a real error", () => {
    const error = new Error("spawn npm ENOENT");
    error.code = "ENOENT";
    assert.equal(isNotFoundError(error), false);
  });
});
