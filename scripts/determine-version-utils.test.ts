import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCanonicalBase,
  computeNextMinor,
  computeNextReleaseVersion,
  devVersion,
  isReleasePublish,
  parseVersion,
  releaseDistTag,
} from "./determine-version-utils.ts";

const NOT_CANONICAL = /not canonical/;

describe("parseVersion", () => {
  it("parses a clean release", () => {
    assert.deepEqual(parseVersion("0.7.0"), { major: 0, minor: 7, patch: 0 });
  });

  it("parses a multi-digit version", () => {
    assert.deepEqual(parseVersion("12.34.567"), {
      major: 12,
      minor: 34,
      patch: 567,
    });
  });

  it("tolerates a pre-release suffix", () => {
    assert.deepEqual(parseVersion("0.7.0-dev.5"), {
      major: 0,
      minor: 7,
      patch: 0,
    });
    assert.deepEqual(parseVersion("1.2.3-foo"), {
      major: 1,
      minor: 2,
      patch: 3,
    });
  });
});

describe("computeNextMinor", () => {
  it("advances 0.7.0 to 0.8.0", () => {
    assert.equal(computeNextMinor("0.7.0"), "0.8.0");
  });

  it("zeros the patch component", () => {
    assert.equal(computeNextMinor("1.2.5"), "1.3.0");
  });

  it("ignores pre-release suffixes on the input", () => {
    assert.equal(computeNextMinor("0.7.0-dev.5"), "0.8.0");
  });
});

describe("computeNextReleaseVersion", () => {
  it("advances an rc base to the next rc", () => {
    assert.equal(computeNextReleaseVersion("8.0.0-rc.1"), "8.0.0-rc.2");
  });

  it("advances a multi-digit rc counter", () => {
    assert.equal(computeNextReleaseVersion("8.0.0-rc.9"), "8.0.0-rc.10");
    assert.equal(computeNextReleaseVersion("8.0.0-rc.41"), "8.0.0-rc.42");
  });

  it("transitions a pre-8 stable base onto the Prisma 8 rc line", () => {
    assert.equal(computeNextReleaseVersion("0.17.0"), "8.0.0-rc.1");
    assert.equal(computeNextReleaseVersion("0.18.0"), "8.0.0-rc.1");
  });

  it("advances a stable 8.x base to the next minor", () => {
    assert.equal(computeNextReleaseVersion("8.0.0"), "8.1.0");
    assert.equal(computeNextReleaseVersion("8.1.0"), "8.2.0");
  });

  it("rejects a non-canonical base", () => {
    assert.throws(
      () => computeNextReleaseVersion("8.0.0-dev.1"),
      NOT_CANONICAL,
    );
  });

  it("rejects rc bases outside the 8.0.0 line", () => {
    assert.throws(
      () => computeNextReleaseVersion("0.17.0-rc.1"),
      NOT_CANONICAL,
    );
    assert.throws(() => computeNextReleaseVersion("8.0.1-rc.1"), NOT_CANONICAL);
    assert.throws(() => computeNextReleaseVersion("9.0.0-rc.1"), NOT_CANONICAL);
  });
});

describe("assertCanonicalBase", () => {
  it("accepts a clean release", () => {
    assert.doesNotThrow(() => assertCanonicalBase("0.7.0"));
    assert.doesNotThrow(() => assertCanonicalBase("1.2.3"));
  });

  it("accepts an rc base", () => {
    assert.doesNotThrow(() => assertCanonicalBase("8.0.0-rc.1"));
    assert.doesNotThrow(() => assertCanonicalBase("8.0.0-rc.42"));
  });

  it("rejects a dev suffix", () => {
    assert.throws(() => assertCanonicalBase("0.7.0-dev.1"), NOT_CANONICAL);
    assert.throws(() => assertCanonicalBase("8.0.0-rc.1-dev.2"), NOT_CANONICAL);
  });

  it("rejects non-rc pre-release suffixes", () => {
    assert.throws(() => assertCanonicalBase("8.0.0-beta.1"), NOT_CANONICAL);
    assert.throws(() => assertCanonicalBase("8.0.0-rc"), NOT_CANONICAL);
    assert.throws(() => assertCanonicalBase("8.0.0-rc."), NOT_CANONICAL);
  });

  it("rejects rc bases outside the 8.0.0 line", () => {
    assert.throws(() => assertCanonicalBase("0.17.0-rc.1"), NOT_CANONICAL);
    assert.throws(() => assertCanonicalBase("8.0.1-rc.1"), NOT_CANONICAL);
    assert.throws(() => assertCanonicalBase("8.1.0-rc.1"), NOT_CANONICAL);
    assert.throws(() => assertCanonicalBase("9.0.0-rc.1"), NOT_CANONICAL);
  });

  it("rejects rc.0 — the counter starts at rc.1", () => {
    assert.throws(() => assertCanonicalBase("8.0.0-rc.0"), NOT_CANONICAL);
  });

  it("rejects a missing component", () => {
    assert.throws(() => assertCanonicalBase("0.7"), NOT_CANONICAL);
  });

  it("rejects an empty string", () => {
    assert.throws(() => assertCanonicalBase(""), NOT_CANONICAL);
  });

  it("rejects components with leading zeros", () => {
    assert.throws(() => assertCanonicalBase("01.2.3"), NOT_CANONICAL);
    assert.throws(() => assertCanonicalBase("1.02.3"), NOT_CANONICAL);
    assert.throws(() => assertCanonicalBase("1.2.03"), NOT_CANONICAL);
    assert.throws(() => assertCanonicalBase("8.0.0-rc.01"), NOT_CANONICAL);
  });
});

describe("releaseDistTag", () => {
  it("sends an RC-line bump to next, so latest stays put until the deliberate flip", () => {
    assert.equal(releaseDistTag("8.0.0-rc.1"), "next");
    assert.equal(releaseDistTag("8.0.0-rc.12"), "next");
  });

  it("sends a stable bump to latest", () => {
    assert.equal(releaseDistTag("8.0.0"), "latest");
    assert.equal(releaseDistTag("8.1.0"), "latest");
  });

  it("refuses a non-canonical base", () => {
    assert.throws(() => releaseDistTag("8.0.0-rc.1-dev.3"), NOT_CANONICAL);
  });
});

describe("devVersion", () => {
  it("suffixes the base with the workflow run number under -dev", () => {
    assert.equal(devVersion("8.0.0-rc.2", "417"), "8.0.0-rc.2-dev.417");
    assert.equal(devVersion("0.17.0", "3"), "0.17.0-dev.3");
  });

  it("refuses a missing or malformed run number", () => {
    assert.throws(() => devVersion("8.0.0-rc.2", ""));
    assert.throws(() => devVersion("8.0.0-rc.2", "0"));
    assert.throws(() => devVersion("8.0.0-rc.2", "abc"));
  });

  it("refuses a non-canonical base, same as every other publish path", () => {
    assert.throws(() => devVersion("8.0.0-rc.2-dev.1", "4"));
  });
});

describe("isReleasePublish", () => {
  it("a dev publish is never a release, and its suffixed version never reaches the canonical check", () => {
    assert.equal(isReleasePublish("8.0.0-rc.2", "dev"), false);
  });

  it("a publish under the base's canonical tag is a release", () => {
    assert.equal(isReleasePublish("8.0.0-rc.2", "next"), true);
    assert.equal(isReleasePublish("8.1.0", "latest"), true);
  });

  it("a beta or off-tag publish is not a release", () => {
    assert.equal(isReleasePublish("8.0.0-rc.2", "beta"), false);
    assert.equal(isReleasePublish("8.0.0-rc.2", "latest"), false);
  });
});
