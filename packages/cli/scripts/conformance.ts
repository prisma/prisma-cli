/**
 * The conformance entry for this repo's publish path: every check
 * against what would ship. Run as `pnpm check:conformance` (a turbo
 * task, so both dists are built first).
 *
 * Ordering is deliberate: check 1 reads dist/, and packing REBUILDS
 * dist/ (prepack runs the build, tsdown cleans), so the tarball check
 * goes last and reads only the extracted tarballs.
 *
 * PUBLISH_CHANNEL says which channel the run is for, and check 4 turns
 * on it: a dev publish may depend on the products' dev builds, a
 * release may not. Unset means `release`, so a workflow that forgets to
 * say blocks a release rather than waving it through.
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
import type { PublishChannel } from "@repo/cli-conformance/release-pins";
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
const PRISMA_DIR = join(CLI_DIR, "..", "prisma");
// At the REPO ROOT, not inside this package: a sandbox node_modules of
// ~440 packages inside packages/cli slows vitest's file crawl enough to
// time out unrelated tests.
const WORK_DIR = join(CLI_DIR, "..", "..", ".conformance", "cli");

const CHANNEL: PublishChannel =
  process.env.PUBLISH_CHANNEL === "dev" ? "dev" : "release";

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
    requiredSpecifiers: ["@prisma/cli-engine", "@prisma/composer-cli/family"],
  });
  const unscoped = checkImportPurity({
    label: "prisma",
    output: await sweepBuiltOutput(join(PRISMA_DIR, "dist")),
    manifest: await manifest(PRISMA_DIR),
    requiredSpecifiers: ["@prisma/cli-engine", "@prisma/composer-cli/family"],
  });
  const engine = checkImportPurity({
    label: "@prisma/cli-engine",
    output: await sweepBuiltOutput(join(ENGINE_DIR, "dist")),
    manifest: await manifest(ENGINE_DIR),
    // c12 is reached via import.meta.resolve plus a realpath'd dynamic
    // import (see config-loader.ts), which the lexer rightly does not
    // count as an import of the bare specifier.
    allowedUnimported: ["c12"],
    requiredSpecifiers: ["@stricli/core"],
  });
  return [...shell, ...unscoped, ...engine];
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
        { name: "prisma", dir: PRISMA_DIR },
        {
          name: "@prisma/cli-engine",
          dir: ENGINE_DIR,
          // Same excuse as check 1: c12 arrives via import.meta.resolve.
          allowedUnimported: ["c12"],
        },
      ],
      shellPackage: "@prisma/cli",
      enginePackage: "@prisma/cli-engine",
      familyPackages: ["@prisma/composer-cli", "@prisma/orm-toolchain"],
      // An entry here exists only while an engine version transition is
      // in flight: the engine must publish before a family can peer it,
      // so the mismatch is real until both families release against it.
      // The entries expire with the versions they name, and the PR that
      // pins the families' 0.4.0-peering releases removes them; while
      // they stand, a release could ship the two-engine install they
      // describe, which is why they must not outlive the transition.
      exceptions: [
        {
          familyPackage: "@prisma/composer-cli",
          familyPin: "0.3.0",
          shellPin: "0.4.0",
          reason: "engine 0.4.0 must publish before composer-cli can peer it",
          removeWhen:
            "composer-cli releases peering 0.4.0 and the follow-up bump PR pins that release",
        },
        {
          familyPackage: "@prisma/orm-toolchain",
          familyPin: "0.3.0",
          shellPin: "0.4.0",
          reason: "engine 0.4.0 must publish before orm-toolchain can peer it",
          removeWhen:
            "orm-toolchain releases peering 0.4.0 and the follow-up bump PR pins that release",
        },
      ],
      channel: CHANNEL,
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
process.stdout.write(`conformance: publishing as a ${CHANNEL}\n`);
process.stdout.write(renderHuman(report));
process.exitCode = exitCodeFor(report);
