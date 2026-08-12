/**
 * The conformance entry for this repo's publish path: all three checks
 * against what would ship. Run as `pnpm check:conformance` (a turbo
 * task, so both dists are built first).
 *
 * Ordering is deliberate: check 1 reads dist/, and packing REBUILDS
 * dist/ (prepack runs the build, tsdown cleans), so the tarball check
 * goes last and reads only the extracted tarballs.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exitCodeFor,
  type Finding,
  renderHuman,
} from "@repo/cli-conformance/findings";
import {
  checkImportPurity,
  type PackageManifest,
} from "@repo/cli-conformance/import-purity";
import { sweepBuiltOutput } from "@repo/cli-conformance/module-graph";
import { sectionsFrom } from "@repo/cli-conformance/subjects";
import { checkTarball } from "@repo/cli-conformance/tarball";
import { realTarballIo } from "@repo/cli-conformance/tarball-io";
import { checkValidatorNoThrow } from "@repo/cli-conformance/validator-no-throw";
import {
  composerCommandFamily,
  mountedCommands,
  ormCommandFamily,
  platformCommandFamily,
} from "../src/cli";

const CLI_DIR = fileURLToPath(new URL("..", import.meta.url));
const ENGINE_DIR = join(CLI_DIR, "..", "cli-engine");
// At the REPO ROOT, not inside this package: a sandbox node_modules of
// ~440 packages inside packages/cli slows vitest's file crawl enough to
// time out unrelated tests.
const WORK_DIR = join(CLI_DIR, "..", "..", ".conformance", "cli");

async function manifest(dir: string): Promise<PackageManifest> {
  return JSON.parse(
    await readFile(join(dir, "package.json"), "utf8"),
  ) as PackageManifest;
}

async function importPurity(): Promise<readonly Finding[]> {
  const shell = checkImportPurity({
    label: "@prisma/cli",
    output: await sweepBuiltOutput(join(CLI_DIR, "dist")),
    manifest: await manifest(CLI_DIR),
    requiredSpecifiers: ["@prisma/cli-engine", "@prisma/composer/family"],
  });
  const engine = checkImportPurity({
    label: "@prisma/cli-engine",
    output: await sweepBuiltOutput(join(ENGINE_DIR, "dist")),
    manifest: await manifest(ENGINE_DIR),
    requiredSpecifiers: ["@stricli/core"],
  });
  return [...shell, ...engine];
}

function validatorNoThrow(): readonly Finding[] {
  return checkValidatorNoThrow({
    sections: sectionsFrom({
      families: [
        platformCommandFamily,
        composerCommandFamily,
        ormCommandFamily,
      ],
      commands: mountedCommands,
    }),
  });
}

async function tarball(): Promise<readonly Finding[]> {
  return checkTarball(
    {
      packages: [
        { name: "@prisma/cli", dir: CLI_DIR },
        { name: "@prisma/cli-engine", dir: ENGINE_DIR },
      ],
      shellPackage: "@prisma/cli",
      enginePackage: "@prisma/cli-engine",
      familyPackages: ["@prisma/composer", "@prisma/orm-toolchain"],
      exceptions: [
        {
          familyPackage: "@prisma/composer",
          familyPin: "0.0.9",
          shellPin: "8.0.0-rc.1",
          reason:
            "operator ruling 2026-08-12: ignore for now — composer cannot pin an engine version that is not published yet",
          removeWhen:
            "composer republishes pinning the engine version prisma-cli ships (tandem order engine → composer → prisma-cli, R-S3-6)",
        },
        {
          familyPackage: "@prisma/orm-toolchain",
          familyPin: "0.0.9",
          shellPin: "8.0.0-rc.1",
          reason:
            "same class, same ruling: the ORM toolchain cannot pin an engine version that is not published yet",
          removeWhen:
            "prisma/prisma republishes @prisma/orm-toolchain pinning the engine version prisma-cli ships",
        },
      ],
      sandboxDir: join(WORK_DIR, "sandbox"),
    },
    realTarballIo(WORK_DIR, {
      // The tarballs the checks verify are the ones publish CI uploads
      // and attaches to the GitHub Release: what was verified is what
      // ships. (This absorbed scripts/tarball-smoke.mjs, which S7 wrote
      // to this check's design as a placeholder for this move.)
      tarballDir: join(CLI_DIR, "..", "..", "artifacts", "tarballs"),
    }),
  );
}

const findings: Finding[] = [
  ...(await importPurity()),
  ...validatorNoThrow(),
  ...(await tarball()),
];
const report = { findings, subjectsChecked: 2 + 1 + 2 };
process.stdout.write(renderHuman(report));
process.exitCode = exitCodeFor(report);
