/**
 * The two conformance checks that have real subjects in this package:
 * import purity on the shell's published output, and validator no-throw
 * on every config section the shell mounts.
 *
 * They live here rather than in @repo/cli-conformance so the checker
 * stays upstream of everything it checks. That direction matters: the
 * checker importing this package would make its own typecheck traverse
 * the whole command tree and depend on the engine's built declarations.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  checkImportPurity,
  type PackageManifest,
} from "@repo/cli-conformance/import-purity";
import { sweepBuiltOutput } from "@repo/cli-conformance/module-graph";
import { sectionsFrom } from "@repo/cli-conformance/subjects";
import { checkValidatorNoThrow } from "@repo/cli-conformance/validator-no-throw";
import { describe, expect, test } from "vitest";
import {
  composerCommandFamily,
  mountedCommands,
  ormCommandFamily,
  platformCommandFamily,
} from "../src/cli";

const HERE = fileURLToPath(new URL(".", import.meta.url));

describe("conformance: validator no-throw", () => {
  const sections = sectionsFrom({
    families: [platformCommandFamily, composerCommandFamily, ormCommandFamily],
    commands: mountedCommands,
  });

  /**
   * Pins the subject set. When the ORM slice adds a second section this
   * fails, which is the point: a new validator gets checked rather than
   * silently skipped.
   */
  test("the shell mounts composer's and orm's sections, and the platform family declares none", () => {
    expect(sections.map((section) => section.name)).toEqual([
      "composer",
      "orm",
    ]);
  });

  test("every config-section validator the shell mounts survives hostile input", () => {
    expect(checkValidatorNoThrow({ sections })).toEqual([]);
  });
});

describe("conformance: import purity", () => {
  test("the built shell imports only what its manifest declares", async () => {
    const output = await sweepBuiltOutput(`${HERE}../dist`);
    const manifest = JSON.parse(
      await readFile(`${HERE}../package.json`, "utf8"),
    ) as PackageManifest;
    expect(
      checkImportPurity({
        label: "@prisma/cli",
        output,
        manifest,
        // Anti-vacuity, and more: these two are the engine boundary this
        // package exists to compose, so a build that stopped importing
        // either one is a broken shell rather than a tidy one.
        requiredSpecifiers: ["@prisma/cli-engine", "@prisma/composer/family"],
      }),
    ).toEqual([]);
  });
});
