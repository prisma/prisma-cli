/**
 * The checks against what this repo actually ships, rather than against
 * fixtures. This is the file that fails when a real regression lands.
 *
 * It imports the shell's own module so the subjects are the objects the
 * shell mounts, not a second list that drifts from them. That reaches
 * composer's validator through @prisma/composer/family — built code, so
 * the validator exercised here is the published one.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// A relative source import across packages, which this repo does
// nowhere else. It is the only route available: @prisma/cli's exports
// map carries `./package.json` and nothing more, so the package cannot
// be imported by name, and its built v8 entry runs the CLI at top level
// rather than exporting anything.
import {
  composerCommandFamily,
  mountedCommands,
  platformCommandFamily,
} from "../../cli/src/v8/cli";
import type { PackageManifest } from "../src/checks/import-purity";
import { checkImportPurity } from "../src/checks/import-purity";
import { checkValidatorNoThrow } from "../src/checks/validator-no-throw";
import { sweepBuiltOutput } from "../src/module-graph";
import { sectionsFrom } from "../src/subjects";

const PACKAGES = fileURLToPath(new URL("../..", import.meta.url));

async function readManifest(name: string): Promise<PackageManifest> {
  return JSON.parse(
    await readFile(join(PACKAGES, name, "package.json"), "utf8"),
  ) as PackageManifest;
}

describe("check 2 against the sections the shell mounts", () => {
  const sections = sectionsFrom({
    families: [platformCommandFamily, composerCommandFamily],
    commands: mountedCommands,
  });

  test("the shell mounts composer's section, and the platform family declares none", () => {
    expect(sections.map((s) => s.name)).toEqual(["composer"]);
  });

  test("every shipped validator survives the hostile corpus", () => {
    expect(checkValidatorNoThrow({ sections })).toEqual([]);
  });
});

describe("check 1 against this repo's published built output", () => {
  test("@prisma/cli-engine imports only what it declares", async () => {
    const output = await sweepBuiltOutput(join(PACKAGES, "cli-engine", "dist"));
    expect(
      checkImportPurity({
        label: "@prisma/cli-engine",
        output,
        manifest: await readManifest("cli-engine"),
        requiredSpecifiers: ["@stricli/core"],
      }),
    ).toEqual([]);
  });

  /**
   * @repo/cli-telemetry is allowed here for one specific reason: the
   * shell bundles it rather than depending on it, and the only mention
   * left in the built output is an `import.meta.resolve` argument inside
   * a try/catch whose fallback covers the published case
   * (packages/cli/src/v8/runtime.ts). The lexer does not report it as an
   * import, so the allowance is belt-and-braces against a future static
   * import appearing — which is exactly what should be caught.
   */
  test("@prisma/cli imports only what it declares", async () => {
    const output = await sweepBuiltOutput(join(PACKAGES, "cli", "dist"));
    expect(
      checkImportPurity({
        label: "@prisma/cli",
        output,
        manifest: await readManifest("cli"),
        requiredSpecifiers: ["@prisma/composer/family", "@prisma/cli-engine"],
      }),
    ).toEqual([]);
  });
});
