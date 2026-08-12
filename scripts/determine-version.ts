#!/usr/bin/env node

/**
 * Composes the version + dist-tag the publish workflow will use.
 *
 * The base version comes from the root `package.json` (the workspace-wide
 * lockstep source of truth — see docs/oss/versioning.md). This script is
 * responsible only for the suffix and dist-tag appropriate to the GitHub
 * event:
 *
 * - `push`              → if the root `version` changed in this push,
 *                          `<base>`, dist-tag from `releaseDistTag`:
 *                          `next` on the RC line, `latest` for stable.
 *                          This is how a merged `chore(release): ...`
 *                          PR ships a release automatically — `latest`
 *                          keeps serving the pre-v8 CLI until the
 *                          operator deliberately moves it.
 *                          Otherwise there is nothing to publish: the
 *                          committed version is already on the registry.
 *                          `publish` is written as `false` and the
 *                          workflow skips the remaining steps.
 * - `workflow_dispatch` → `<base>` (no suffix), dist-tag from
 *                          `INPUT_DIST_TAG`; empty means the version's
 *                          canonical tag (`releaseDistTag`). Useful as a
 *                          manual escape hatch (re-publish after a
 *                          transient failure, cut a beta) — and passing
 *                          `latest` explicitly for an RC version is the
 *                          deliberate cutover act.
 *
 * Outputs `publish`, `version`, `tag` and `release` to `$GITHUB_OUTPUT`
 * for downstream workflow steps to consume.
 *
 * This script never rewrites a manifest. The version it reports is the
 * one committed at this ref, always — which is the whole point of
 * keeping the version in `package.json` (docs/oss/versioning.md).
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { VersionResult } from "./determine-version-utils.ts";
import {
  assertCanonicalBase,
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
  result: VersionResult | undefined,
  publish: boolean,
): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  appendFileSync(outputFile, `publish<<EOF\n${String(publish)}\nEOF\n`);
  if (result === undefined) return;
  appendFileSync(outputFile, `version<<EOF\n${result.version}\nEOF\n`);
  appendFileSync(outputFile, `tag<<EOF\n${result.tag}\nEOF\n`);
  // A run is a release — and gets the GitHub Release + tag — when it
  // publishes under the canonical tag for its version. Push bumps
  // always do; a dispatch counts only when the chosen tag matches
  // (re-publishing a release), not for beta/preview cuts.
  const release = result.tag === releaseDistTag(result.version);
  appendFileSync(outputFile, `release<<EOF\n${String(release)}\nEOF\n`);
}

const eventName = process.env.GITHUB_EVENT_NAME;
const inputDistTag = process.env.INPUT_DIST_TAG;

const baseVersion = readRootVersion();
assertCanonicalBase(baseVersion);

console.log(`Event:                 ${eventName}`);
console.log(`Base version (root):   ${baseVersion}`);

let result: VersionResult | undefined;

switch (eventName) {
  case "workflow_dispatch":
    // `??` is wrong here: an empty INPUT_DIST_TAG must fall through to
    // the canonical tag, not become `pnpm publish --tag ""` downstream.
    // Empty (the input's default) means "this version's canonical tag",
    // so a routine re-publish dispatch can never move `latest` onto the
    // RC line by accident; moving it takes an explicit `latest` input.
    result = {
      version: baseVersion,
      tag: inputDistTag || releaseDistTag(baseVersion),
    };
    break;

  case "push": {
    // A push publishes exactly when it changes the committed version.
    // Every other push has nothing to ship: the version at this ref is
    // already on the registry, and inventing a different one would mean
    // publishing something no commit describes.
    //
    // `available: false` (shallow clone, missing SHA) deliberately means
    // "do not publish": a transient git error must never promote to
    // `latest`, and skipping is recoverable by dispatching the workflow.
    const previous = readPreviousRootVersion();
    const isReleaseBump =
      previous.available && previous.version !== baseVersion;
    if (isReleaseBump) {
      console.log(
        `Previous root version: ${previous.version ?? "(unset)"} → release bump detected.`,
      );
      result = { version: baseVersion, tag: releaseDistTag(baseVersion) };
    } else {
      console.log(
        previous.available
          ? "Root version unchanged by this push — nothing to publish."
          : "Could not read the previous root version — not publishing.",
      );
      result = undefined;
    }
    break;
  }

  default:
    throw new Error(`don't know how to handle event ${eventName}`);
}

if (result === undefined) {
  writeGitHubOutput(undefined, false);
} else {
  console.log(`Resolved version:      ${result.version}`);
  console.log(`Resolved dist-tag:     ${result.tag}`);
  writeGitHubOutput(result, true);
}
