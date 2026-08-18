#!/usr/bin/env node

/**
 * The versions the publish workflow will use, from the root
 * `package.json` at this ref: always a dev version, and a release
 * version when this push changed it. Not either/or — see
 * docs/oss/versioning.md for why.
 *
 * Outputs `devVersion`, `release`, `releaseVersion`, `releaseTag` and
 * `githubRelease`. Never rewrites a manifest.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCanonicalBase,
  assertValidDistTag,
  devVersion,
  isReleasePublish,
  releaseDistTag,
} from "./determine-version-utils.ts";

const ALL_ZERO_SHA_PATTERN = /^0+$/;

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function readRootVersion(): string {
  const pkgPath = join(rootDir, "package.json");
  const parsed = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    version?: unknown;
  };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(
      `Root package.json (${pkgPath}) is missing a \`version\` field. ` +
        "The publish pipeline reads the version directly from the workspace root; " +
        "set it (e.g. `pnpm bump-version`) before publishing.",
    );
  }
  return parsed.version;
}

type PreviousVersionLookup =
  | { available: true; version: string | undefined }
  | { available: false };

/** The root `version` at `PUSH_BEFORE_SHA`, if it can be read at all. */
function readPreviousRootVersion(): PreviousVersionLookup {
  const beforeSha = process.env.PUSH_BEFORE_SHA;
  if (!beforeSha || ALL_ZERO_SHA_PATTERN.test(beforeSha)) {
    return { available: false };
  }
  try {
    const json = execFileSync("git", ["show", `${beforeSha}:package.json`], {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parsed = JSON.parse(json) as { version?: unknown };
    return {
      available: true,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    };
  } catch {
    return { available: false };
  }
}

function writeGitHubOutput(
  devVersion: string,
  release: { version: string; tag: string } | undefined,
): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  appendFileSync(outputFile, `devVersion<<EOF\n${devVersion}\nEOF\n`);
  appendFileSync(
    outputFile,
    `release<<EOF\n${String(release !== undefined)}\nEOF\n`,
  );
  if (release === undefined) return;
  appendFileSync(outputFile, `releaseVersion<<EOF\n${release.version}\nEOF\n`);
  appendFileSync(outputFile, `releaseTag<<EOF\n${release.tag}\nEOF\n`);
  // A beta cut publishes to npm but gets no GitHub Release.
  appendFileSync(
    outputFile,
    `githubRelease<<EOF\n${String(isReleasePublish(release.version, release.tag))}\nEOF\n`,
  );
}

const eventName = process.env.GITHUB_EVENT_NAME;
const inputDistTag = process.env.INPUT_DIST_TAG;
const runNumber = process.env.GITHUB_RUN_NUMBER ?? "";

const baseVersion = readRootVersion();
assertCanonicalBase(baseVersion);

console.log(`Event:                 ${eventName}`);
console.log(`Base version (root):   ${baseVersion}`);

const dev = devVersion(baseVersion, runNumber);

let release: { version: string; tag: string } | undefined;

switch (eventName) {
  case "workflow_dispatch":
    // `||`, not `??`: an empty INPUT_DIST_TAG must fall through to the
    // canonical tag, not become `pnpm publish --tag ""`.
    if (inputDistTag) assertValidDistTag(inputDistTag);
    release = {
      version: baseVersion,
      tag: inputDistTag || releaseDistTag(baseVersion),
    };
    break;

  case "push": {
    // An unreadable previous version means no release: a transient git
    // error must never promote to `latest`.
    const previous = readPreviousRootVersion();
    if (!previous.available) {
      console.log(
        "Could not read the previous root version — publishing the dev build only.",
      );
    } else if (previous.version !== baseVersion) {
      console.log(
        `Previous root version: ${previous.version ?? "(unset)"} → release bump detected.`,
      );
      release = { version: baseVersion, tag: releaseDistTag(baseVersion) };
    } else {
      console.log("Root version unchanged by this push → dev build only.");
    }
    break;
  }

  default:
    throw new Error(`don't know how to handle event ${eventName}`);
}

if (release !== undefined && !isReleasePublish(baseVersion, release.tag)) {
  console.log(
    `Dist-tag ${release.tag} is not ${baseVersion}'s canonical tag — publishing it, but not as a release.`,
  );
}

console.log(`Dev version:           ${dev}`);
console.log(
  `Release:               ${release === undefined ? "no" : `${release.version} under ${release.tag}`}`,
);
writeGitHubOutput(dev, release);
