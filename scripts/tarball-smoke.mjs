#!/usr/bin/env node

// biome-ignore-all lint/performance/noAwaitInLoops: every step here is sequential by design — packs share one turbo cache, and a failing bin must be reported against the package that failed.

// The tarball install smoke: pack the publishable packages, install the
// CLI's tarball in a sandbox OUTSIDE the workspace, and start every
// declared bin on plain Node. This is the check standing between a
// publish and a tarball that does not start for users.
//
// Written to S6's check-3b design (specs/s6-conformance.md on the S6
// branch, ruled 2026-08-12) so the conformance slice absorbs it as a
// move, not a rewrite. The mechanics it fixes in place:
//
// - `pnpm pack`, never `npm pack`: only pnpm rewrites `workspace:` pins
//   to exact versions in the packed manifest.
// - The sandbox lives outside the repo: with corepack enabled, npm's
//   shim walks up from the sandbox to the repo root, finds
//   `"packageManager": "pnpm"`, and refuses to run.
// - npm installs with `--ignore-scripts`: the publish runner holds
//   `id-token: write`, and third-party postinstalls do not run at the
//   pipeline's most privileged moment. (npm rather than pnpm here is the
//   ruled exception: the sandbox simulates a registry consumer.)
// - Unpublished workspace siblings resolve through computed npm
//   `overrides` with absolute `file:` paths and version-qualified keys
//   (see tarball-smoke-utils.mjs).

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { computeOverrides, declaredBins } from "./tarball-smoke-utils.mjs";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The lockstep publish list, in publish order. The subject whose bins
 *  the smoke starts is the CLI; the engine rides in as its override. */
const PACKED_PACKAGES = ["packages/cli-engine", "packages/cli"];
const SUBJECT = "@prisma/cli";

const TARBALL_DIR = path.join(repoRoot, "artifacts", "tarballs");
const BIN_TIMEOUT_MS = 60_000;

async function main() {
  await rm(TARBALL_DIR, { recursive: true, force: true });
  await mkdir(TARBALL_DIR, { recursive: true });

  const workspacePackages = new Map();
  for (const packageDir of PACKED_PACKAGES) {
    const absoluteDir = path.join(repoRoot, packageDir);
    const manifest = JSON.parse(
      await readFile(path.join(absoluteDir, "package.json"), "utf8"),
    );
    const { stdout } = await execFileAsync(
      "pnpm",
      ["pack", "--pack-destination", TARBALL_DIR],
      { cwd: absoluteDir },
    );
    const tarballPath = stdout.trim().split("\n").at(-1);
    if (!tarballPath?.endsWith(".tgz")) {
      throw new Error(
        `pnpm pack in ${packageDir} did not report a tarball path (got: ${tarballPath})`,
      );
    }
    workspacePackages.set(manifest.name, { manifest, tarballPath });
    process.stdout.write(`packed ${manifest.name} -> ${tarballPath}\n`);
  }

  const subject = workspacePackages.get(SUBJECT);
  if (!subject) throw new Error(`${SUBJECT} was not packed`);

  const sandbox = await mkdtemp(path.join(os.tmpdir(), "prisma-cli-smoke-"));
  try {
    await writeFile(
      path.join(sandbox, "package.json"),
      `${JSON.stringify(
        {
          name: "prisma-cli-tarball-smoke",
          private: true,
          dependencies: { [SUBJECT]: `file:${subject.tarballPath}` },
          overrides: computeOverrides(subject.manifest, workspacePackages),
        },
        null,
        2,
      )}\n`,
    );

    await execFileAsync(
      "npm",
      ["install", "--no-audit", "--no-fund", "--ignore-scripts"],
      { cwd: sandbox, timeout: 300_000 },
    );

    // The bins come from the INSTALLED manifests — the packed,
    // workspace-rewritten metadata a registry consumer would get — not
    // from the repo's working manifests.
    let binsStarted = 0;
    for (const name of workspacePackages.keys()) {
      const installedDir = path.join(
        sandbox,
        "node_modules",
        ...name.split("/"),
      );
      const installedManifest = JSON.parse(
        await readFile(path.join(installedDir, "package.json"), "utf8"),
      );
      for (const bin of declaredBins(installedManifest)) {
        const binPath = path.join(installedDir, bin.path);
        const { stdout } = await execFileAsync(
          process.execPath,
          [binPath, "--version"],
          {
            cwd: sandbox,
            env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
            timeout: BIN_TIMEOUT_MS,
          },
        );
        binsStarted += 1;
        process.stdout.write(
          `bin ${bin.name} (${name}) started on plain Node: ${stdout.trim().slice(0, 200)}\n`,
        );
      }
    }

    // An empty subject set is a broken invocation, not a pass.
    if (binsStarted === 0) {
      throw new Error(
        "no declared bin was found in any packed package — the smoke checked nothing",
      );
    }

    process.stdout.write(
      `tarball smoke passed: ${workspacePackages.size} packages packed, ${binsStarted} bin(s) started\n`,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

await main();
