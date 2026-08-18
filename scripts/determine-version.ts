#!/usr/bin/env node

/**
 * Composes the versions the publish workflow will use.
 *
 * Every run publishes a dev build; a run also publishes a release when
 * the committed version changed. The two are not alternatives, and that
 * is deliberate: when they were, the release commit became the one merge
 * to `main` that never reached the dev channel, so the `dev` dist-tag sat
 * on an older version than the release until an unrelated commit landed
 * (operator ruling 2026-08-18).
 *
 * The base version comes from the root `package.json` (the workspace-wide
 * lockstep source of truth — see docs/oss/versioning.md).
 *
 * - dev, always      → `<base>-dev.<run>` under the `dev` dist-tag. The
 *                      suffix derives from the run number and the
 *                      workflow stamps it ephemerally, never committing
 *                      it.
 * - release, when    → `<base>` under `releaseDistTag`: `next` on the RC
 *   the version         line, `latest` for stable. This is how a merged
 *   changed             `chore(release): ...` PR ships automatically;
 *                       `latest` keeps serving the pre-8 CLI until the
 *                       operator deliberately moves it.
 * - `workflow_dispatch` always offers the release half, with the dist-tag
 *                      from `INPUT_DIST_TAG`; empty means the canonical
 *                      tag. The manual escape hatch: re-publish after a
 *                      transient failure, or cut a beta. Passing `latest`
 *                      explicitly for an RC version is the deliberate
 *                      cutover act.
 *
 * Outputs `devVersion`, `release`, `releaseVersion`, `releaseTag` and
 * `githubRelease` to `$GITHUB_OUTPUT`.
 *
 * This script never rewrites a manifest. Release versions are the ones
 * committed at this ref, always.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCanonicalBase,
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

/**
 * Reads the root `package.json` `version` at `PUSH_BEFORE_SHA` (the ref
 * that `main` pointed at *before* the push). Distinguishes "we
 * successfully read the previous file" (so the comparison is meaningful)
 * from "we couldn't" (shallow clone, missing SHA, etc.) so the caller
 * can fall back to the safe `dev` path on any I/O hiccup.
 */
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
  // Publishing under a version's canonical tag is a release and gets a
  // GitHub Release; a beta or preview cut publishes to npm and does not.
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

// Every run publishes a dev build. Nothing decides that; it is why the
// `dev` tag can never name an older version than the release tag. The
// release publish is the conditional half.
const dev = devVersion(baseVersion, runNumber);

let release: { version: string; tag: string } | undefined;

switch (eventName) {
  case "workflow_dispatch":
    // `??` is wrong here: an empty INPUT_DIST_TAG must fall through to
    // the canonical tag, not become `pnpm publish --tag ""` downstream.
    // Empty (the input's default) means "this version's canonical tag",
    // so a routine re-publish dispatch can never move `latest` onto the
    // RC line by accident; moving it takes an explicit `latest` input.
    release = {
      version: baseVersion,
      tag: inputDistTag || releaseDistTag(baseVersion),
    };
    break;

  case "push": {
    // A push releases exactly when it changes the committed version.
    // `available: false` (shallow clone, missing SHA) means "do not
    // release": a transient git error must never promote to `latest`,
    // and the dev build still ships, so nothing is lost that the next
    // push does not repair.
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

// A beta or preview cut publishes to npm but is not a release: it gets
// no GitHub Release, and `isReleasePublish` is what tells them apart.
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
