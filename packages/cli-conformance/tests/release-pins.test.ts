/**
 * Check 4. Plain values in, findings out — the manifests arrive from
 * whoever packed them, so this suite touches nothing.
 */
import { describe, expect, test } from "vitest";
import { checkReleasePins } from "../src/checks/release-pins";

const SHELL = {
  name: "@prisma/cli",
  version: "8.0.0-rc.4",
  dependencies: {
    "@prisma/cli-engine": "0.1.1",
    "@prisma/composer-cli": "0.6.0-dev.22",
    "@prisma/orm-toolchain": "8.0.0-rc.1-dev.40",
    dotenv: "^17.4.2",
  },
  devDependencies: { "@repo/tsconfig": "8.0.0-rc.4-dev.7" },
};

describe("checkReleasePins", () => {
  test("a release that depends on dev builds is reported, one finding per dependency", () => {
    const findings = checkReleasePins({
      manifests: [SHELL],
      channel: "release",
    });
    expect(findings.map((f) => f.subject)).toEqual([
      "@prisma/composer-cli",
      "@prisma/orm-toolchain",
    ]);
    expect(findings.every((f) => f.kind === "dev-build-in-release")).toBe(true);
    expect(findings[0]?.summary).toContain("0.6.0-dev.22");
    expect(findings[0]?.summary).toContain("@prisma/cli");
  });

  /**
   * No exception mechanism, deliberately: a suppressed finding exits 0,
   * and letting a release ship dev builds on a recorded excuse is the
   * hole this check exists to close.
   */
  test("nothing suppresses a dev build in a release", () => {
    const findings = checkReleasePins({
      manifests: [SHELL],
      channel: "release",
    });
    expect(findings.every((f) => f.suppressedBy === undefined)).toBe(true);
  });

  test("a dev publish is allowed to depend on dev builds — that is the channel", () => {
    expect(checkReleasePins({ manifests: [SHELL], channel: "dev" })).toEqual(
      [],
    );
  });

  test("a release line that is itself a pre-release is not a dev build", () => {
    expect(
      checkReleasePins({
        manifests: [
          {
            name: "@prisma/cli",
            dependencies: {
              "@prisma/orm-toolchain": "8.0.0-rc.1",
              "@prisma/composer-cli": "0.6.1",
            },
          },
        ],
        channel: "release",
      }),
    ).toEqual([]);
  });

  test("`dev` must stand alone, so a version that merely contains the letters is a release", () => {
    expect(
      checkReleasePins({
        manifests: [
          {
            name: "@prisma/cli",
            dependencies: {
              deviant: "1.0.0-development.1",
              "some-pkg": "2.0.0-predev",
            },
          },
        ],
        channel: "release",
      }),
    ).toEqual([]);
  });

  test("every dependency field a consumer's install resolves is measured, and devDependencies are not", () => {
    const findings = checkReleasePins({
      manifests: [
        {
          name: "@prisma/cli",
          dependencies: { a: "1.0.0-dev.1" },
          optionalDependencies: { b: "1.0.0-dev.2" },
          peerDependencies: { c: "1.0.0-dev.3" },
          devDependencies: { d: "1.0.0-dev.4" },
        },
      ],
      channel: "release",
    });
    expect(findings.map((f) => f.subject)).toEqual(["a", "b", "c"]);
  });

  test("a range that admits only dev builds is reported too", () => {
    const findings = checkReleasePins({
      manifests: [
        { name: "@prisma/cli", dependencies: { a: ">=1.0.0-dev.1 <1.1.0" } },
      ],
      channel: "release",
    });
    expect(findings.map((f) => f.subject)).toEqual(["a"]);
  });

  test("no manifests means nothing was proved, not that everything passed", () => {
    const findings = checkReleasePins({ manifests: [], channel: "release" });
    expect(findings.map((f) => f.kind)).toEqual(["no-subjects"]);
  });

  test("every finding names the check, so a mixed report stays readable", () => {
    const findings = checkReleasePins({
      manifests: [SHELL],
      channel: "release",
    });
    expect(findings.every((f) => f.check === "release-pins")).toBe(true);
  });
});
