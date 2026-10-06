#!/usr/bin/env node

// Fails a pull request that changes `packages/cli-engine` while leaving
// its version at one the registry already has. That is how
// `prisma@8.0.0-rc.4` shipped: the CLI was built against engine exports
// that the published `@prisma/cli-engine@0.1.1` does not contain, and
// `npx prisma@next` crashed on import. The registry is immutable, so a
// changed engine must claim a new version (`pnpm bump-cli-engine-version`).
// An engine-first release can already be published: its npm provenance
// must identify the same engine source before that version may be reused.
//
// Usage: node scripts/check-engine-version.mjs <base-ref>

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const NPM_NOT_FOUND_PATTERN = /\bE404\b/;

/** Whether a failed `npm view` means the version is absent, as opposed
 * to npm itself failing — no binary, no network, no auth. */
function isNotFoundError(error) {
  if (typeof error !== "object" || error === null) return false;
  const { stderr, stdout } = error;
  return NPM_NOT_FOUND_PATTERN.test(`${stderr ?? ""}\n${stdout ?? ""}`);
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const ENGINE_MANIFEST = "packages/cli-engine/package.json";
const COMMIT_SHA = /^[a-f0-9]{40}$/;

/** The registry's provenance must name this engine artifact and publisher. */
export function publishedEngineCommit(attestations, version, integrity) {
  if (!integrity?.startsWith("sha512-")) return undefined;
  const digest = Buffer.from(integrity.slice(7), "base64").toString("hex");
  for (const attestation of attestations.attestations ?? []) {
    if (attestation.predicateType !== "https://slsa.dev/provenance/v1")
      continue;
    const payload = attestation.bundle?.dsseEnvelope?.payload;
    if (typeof payload !== "string") continue;
    const statement = JSON.parse(Buffer.from(payload, "base64").toString());
    const build = statement.predicate?.buildDefinition;
    const workflow = build?.externalParameters?.workflow;
    if (
      workflow?.repository !== "https://github.com/prisma/prisma-cli" ||
      workflow.path !== ".github/workflows/publish.yml" ||
      !statement.subject?.some(
        (subject) =>
          subject.name === `pkg:npm/%40prisma/cli-engine@${version}` &&
          subject.digest?.sha512 === digest,
      )
    )
      continue;
    const source = build.resolvedDependencies?.find((dependency) =>
      dependency.uri?.startsWith("git+https://github.com/prisma/prisma-cli@"),
    );
    if (COMMIT_SHA.test(source?.digest?.gitCommit ?? ""))
      return source.digest.gitCommit;
  }
  return undefined;
}

/**
 * Whether a manifest change alters what npm publishes. devDependencies
 * never ship in the tarball — the release version sweep rewrites the
 * engine's `@repo/*` devDependencies on every bump, and that must not
 * read as "the engine changed".
 *
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} head
 * @returns {boolean}
 */
export function manifestChangeShips(base, head) {
  const shipped = ({ devDependencies: _dev, ...rest }) => rest;
  return JSON.stringify(shipped(base)) !== JSON.stringify(shipped(head));
}

/**
 * @param {{ changedFiles: readonly string[], engineVersion: string, versionOnRegistry: boolean, publishedSourceMatches?: boolean }} input
 * @returns {string | null} the failure message, or null when the change is fine
 */
export function engineBumpVerdict({
  changedFiles,
  engineVersion,
  versionOnRegistry,
  publishedSourceMatches = false,
}) {
  const engineChanged = changedFiles.some((file) =>
    file.startsWith("packages/cli-engine/"),
  );
  if (!engineChanged || !versionOnRegistry || publishedSourceMatches)
    return null;
  return (
    `packages/cli-engine changed, but its version (${engineVersion}) is already on the registry, ` +
    "and published versions are immutable. Run `pnpm bump-cli-engine-version <patch|minor>` " +
    "so the changed engine ships under a new version."
  );
}

async function changedFilesSince(baseSha) {
  const { stdout: diff } = await execFileAsync(
    "git",
    ["diff", "--name-only", baseSha, "HEAD"],
    { cwd: rootDir },
  );
  let changedFiles = diff.split("\n").filter(Boolean);

  if (changedFiles.includes(ENGINE_MANIFEST)) {
    const { stdout: baseManifest } = await execFileAsync(
      "git",
      ["show", `${baseSha}:${ENGINE_MANIFEST}`],
      { cwd: rootDir },
    );
    const headManifest = readFileSync(join(rootDir, ENGINE_MANIFEST), "utf-8");
    if (
      !manifestChangeShips(JSON.parse(baseManifest), JSON.parse(headManifest))
    ) {
      changedFiles = changedFiles.filter((file) => file !== ENGINE_MANIFEST);
    }
  }
  return changedFiles;
}

async function main() {
  const baseSha = process.argv[2];
  if (!baseSha) {
    console.error("Usage: node scripts/check-engine-version.mjs <base-ref>");
    process.exit(1);
  }

  const { stdout: mergeBase } = await execFileAsync(
    "git",
    ["merge-base", baseSha, "HEAD"],
    { cwd: rootDir },
  );
  const changedFiles = await changedFilesSince(mergeBase.trim());

  const manifest = JSON.parse(
    readFileSync(join(rootDir, "packages/cli-engine/package.json"), "utf-8"),
  );
  const engineVersion = manifest.version;

  let versionOnRegistry = true;
  let publishedManifest;
  try {
    const { stdout } = await execFileAsync("npm", [
      "view",
      `@prisma/cli-engine@${engineVersion}`,
      "--json",
      "--prefer-online",
    ]);
    publishedManifest = JSON.parse(stdout);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    versionOnRegistry = false;
  }

  let publishedSourceMatches = false;
  if (
    versionOnRegistry &&
    changedFiles.some((file) => file.startsWith("packages/cli-engine/")) &&
    publishedManifest?.dist?.attestations?.provenance
  ) {
    const response = await fetch(
      `https://registry.npmjs.org/-/npm/v1/attestations/@prisma%2fcli-engine@${encodeURIComponent(engineVersion)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok)
      throw new Error(`Engine provenance lookup failed (${response.status})`);
    const publishedCommit = publishedEngineCommit(
      await response.json(),
      engineVersion,
      publishedManifest.dist.integrity,
    );
    if (publishedCommit !== undefined) {
      const sincePublication = await changedFilesSince(publishedCommit);
      publishedSourceMatches = !sincePublication.some((file) =>
        file.startsWith("packages/cli-engine/"),
      );
    }
  }

  const verdict = engineBumpVerdict({
    changedFiles,
    engineVersion,
    versionOnRegistry,
    publishedSourceMatches,
  });
  if (verdict !== null) {
    console.error(`::error::${verdict}`);
    process.exit(1);
  }
  console.log(
    `Engine version ${engineVersion} is consistent with this change set.`,
  );
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) await main();
