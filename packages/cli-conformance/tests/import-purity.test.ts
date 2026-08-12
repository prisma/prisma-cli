/**
 * Check 1. The manifest and the swept output are both injected, so
 * every case here is a plain value — no package tree to build and
 * nothing to mock.
 */
import { describe, expect, test } from "vitest";
import { checkImportPurity } from "../src/checks/import-purity";
import type { BuiltOutput } from "../src/module-graph";

function output(...specifiers: readonly string[]): BuiltOutput {
  return {
    files: ["cli.js"],
    imports: specifiers.map((specifier) => ({
      root: specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : (specifier.split("/")[0] ?? specifier),
      specifier,
      file: "cli.js",
    })),
  };
}

const kinds = (findings: readonly { kind: string }[]): string[] =>
  findings.map((f) => f.kind).sort();

describe("checkImportPurity", () => {
  test("an import the manifest does not declare is a finding naming file and specifier", () => {
    const findings = checkImportPurity({
      label: "@prisma/cli",
      output: output("undeclared-pkg/sub"),
      manifest: { dependencies: {} },
    });
    expect(kinds(findings)).toEqual(["undeclared-import"]);
    expect(findings[0]?.summary).toContain("undeclared-pkg/sub");
    expect(findings[0]?.where?.path).toBe("cli.js");
  });

  test("a peer dependency counts as declared", () => {
    expect(
      checkImportPurity({
        label: "@prisma/cli",
        output: output("typescript"),
        manifest: { peerDependencies: { typescript: ">=5" } },
      }),
    ).toEqual([]);
  });

  test("an optional dependency counts as declared", () => {
    expect(
      checkImportPurity({
        label: "@prisma/cli",
        output: output("fsevents"),
        manifest: { optionalDependencies: { fsevents: "^2" } },
      }),
    ).toEqual([]);
  });

  test("a devDependency does not count as declared — consumers never install it", () => {
    expect(
      kinds(
        checkImportPurity({
          label: "@prisma/cli",
          output: output("@repo/cli-telemetry"),
          manifest: {
            devDependencies: { "@repo/cli-telemetry": "workspace:*" },
          },
        }),
      ),
    ).toEqual(["undeclared-import"]);
  });

  test("a private name the caller allows is not a finding", () => {
    expect(
      checkImportPurity({
        label: "@prisma/cli",
        output: output("@repo/cli-telemetry"),
        manifest: { dependencies: {} },
        allowedPrivate: ["@repo/cli-telemetry"],
      }),
    ).toEqual([]);
  });

  test("a declared runtime dependency the output never imports is its own finding", () => {
    const findings = checkImportPurity({
      label: "@prisma/cli",
      output: output("used-pkg"),
      manifest: { dependencies: { "used-pkg": "^1", "never-used": "^1" } },
    });
    expect(kinds(findings)).toEqual(["unimported-dependency"]);
    expect(findings[0]?.summary).toContain("never-used");
  });

  /**
   * The two halves of this check pull against each other. The forward
   * half deliberately ignores `import.meta.resolve`, so a dependency
   * reached ONLY that way looks unimported to the reverse half. That is
   * the shipped telemetry pattern, and it escapes today only because
   * @repo/cli-telemetry is a devDependency rather than a dependency.
   */
  test("a dependency the caller says is reached without a static import is not a finding", () => {
    expect(
      checkImportPurity({
        label: "@prisma/cli",
        output: output("used-pkg"),
        manifest: {
          dependencies: { "used-pkg": "^1", "resolved-at-runtime": "^1" },
        },
        allowedUnimported: ["resolved-at-runtime"],
      }),
    ).toEqual([]);
  });

  test("only dependencies are held to the reverse half, never peers or optionals", () => {
    expect(
      checkImportPurity({
        label: "@prisma/cli",
        output: output("used-pkg"),
        manifest: {
          dependencies: { "used-pkg": "^1" },
          peerDependencies: { typescript: ">=5" },
          optionalDependencies: { fsevents: "^2" },
        },
      }),
    ).toEqual([]);
  });

  /** Anti-vacuity: a check that swept nothing has proved nothing. */
  test("output with no files is a finding, not a pass", () => {
    expect(
      kinds(
        checkImportPurity({
          label: "@prisma/cli",
          output: { files: [], imports: [] },
          manifest: { dependencies: {} },
        }),
      ),
    ).toEqual(["no-output"]);
  });

  test("a required specifier missing from the output is a finding", () => {
    const findings = checkImportPurity({
      label: "@prisma/cli",
      output: output("@prisma/cli-engine"),
      manifest: { dependencies: { "@prisma/cli-engine": "8.0.0-rc.1" } },
      requiredSpecifiers: ["@prisma/composer/family"],
    });
    expect(kinds(findings)).toEqual(["missing-required-specifier"]);
    expect(findings[0]?.summary).toContain("@prisma/composer/family");
  });

  test("a required specifier present in the output is not a finding", () => {
    expect(
      checkImportPurity({
        label: "@prisma/cli",
        output: output("@prisma/composer/family"),
        manifest: { dependencies: { "@prisma/composer": "0.6.0-dev.16" } },
        requiredSpecifiers: ["@prisma/composer/family"],
      }),
    ).toEqual([]);
  });

  test("every finding carries the package label so a multi-package run stays legible", () => {
    const findings = checkImportPurity({
      label: "@prisma/cli-engine",
      output: output("undeclared-pkg"),
      manifest: {},
    });
    expect(findings[0]?.subject).toBe("@prisma/cli-engine");
    expect(findings[0]?.check).toBe("import-purity");
  });
});
