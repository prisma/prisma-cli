#!/usr/bin/env node

import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function resolveDevVersion(options) {
  const baseVersion = requireValue(options.baseVersion, "baseVersion");
  const runNumber = requireValue(options.runNumber, "runNumber");
  const runAttempt = requireValue(options.runAttempt, "runAttempt");

  return `${baseVersion}-dev.${runNumber}.${runAttempt}`;
}

export function resolvePrVersion(options) {
  const baseVersion = requireValue(options.baseVersion, "baseVersion");
  const prNumber = requireValue(options.prNumber, "prNumber");
  const sha = shortSha(requireValue(options.sha, "sha"));

  return `${baseVersion}-pr.${prNumber}.sha${sha}`;
}

export function resolveNextBetaVersion(options) {
  const baseVersion = requireValue(options.baseVersion, "baseVersion");
  const latest = options.latest;
  const normalizedLatest = (latest ?? "").trim();

  if (!normalizedLatest || isOlderReleaseLine(normalizedLatest, baseVersion)) {
    return `${baseVersion}-beta.0`;
  }

  const betaMatch = normalizedLatest.match(new RegExp(`^${escapeRegExp(baseVersion)}-beta\\.(\\d+)$`));
  if (betaMatch) {
    const nextNumber = Number(betaMatch[1]) + 1;
    return `${baseVersion}-beta.${nextNumber}`;
  }

  throw new Error(
    `Cannot compute the next beta from npm latest (${normalizedLatest}). Expected no latest, a lower release line, or ${baseVersion}-beta.N.`,
  );
}

export function resolvePackageReleaseBaseVersion(packageDir) {
  const manifestPath = path.join(getRepoRoot(), packageDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version = requireValue(manifest.version, `${packageDir} package.json version`);
  const match = version.match(/^(\d+\.\d+\.\d+)(?:-.+)?$/);

  if (!match) {
    throw new Error(`Cannot derive release base from ${packageDir} package version (${version}).`);
  }

  return match[1];
}

function getRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function isOlderReleaseLine(latest, baseVersion) {
  const latestParts = parseVersionCore(latest);
  const baseParts = parseVersionCore(baseVersion);

  if (!latestParts || !baseParts) {
    return false;
  }

  for (let index = 0; index < baseParts.length; index += 1) {
    if (latestParts[index] < baseParts[index]) {
      return true;
    }

    if (latestParts[index] > baseParts[index]) {
      return false;
    }
  }

  return false;
}

function parseVersionCore(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);

  if (!match) {
    return undefined;
  }

  return match.slice(1).map(Number);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortSha(sha) {
  return sha.slice(0, 12);
}

function requireValue(value, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${name} is required.`);
  }

  return String(value);
}

function parseOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const inlineValueIndex = arg.indexOf("=");
    if (inlineValueIndex !== -1) {
      options[arg.slice(2, inlineValueIndex)] = arg.slice(inlineValueIndex + 1);
      continue;
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} requires a value.`);
    }

    options[arg.slice(2)] = value;
    index += 1;
  }

  return options;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  const packageDir = requireValue(options["package-dir"], "package-dir");
  const baseVersion = resolvePackageReleaseBaseVersion(packageDir);

  if (command === "dev") {
    process.stdout.write(`version=${resolveDevVersion({
      baseVersion,
      runNumber: options["run-number"],
      runAttempt: options["run-attempt"],
    })}\n`);
    return;
  }

  if (command === "pr") {
    process.stdout.write(`version=${resolvePrVersion({
      baseVersion,
      prNumber: options["pr-number"],
      sha: options.sha,
    })}\n`);
    return;
  }

  if (command === "next-beta") {
    const latest = options.latest ?? "";
    process.stdout.write(`latest=${latest}\n`);
    process.stdout.write(`version=${resolveNextBetaVersion({ baseVersion, latest })}\n`);
    return;
  }

  throw new Error("Usage: resolve-package-version.mjs <dev|pr|next-beta> [--package-dir <path>] [options]");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
