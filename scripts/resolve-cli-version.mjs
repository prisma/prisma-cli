#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_RELEASE_BASE_VERSION = "3.0.0";

export function resolveDevVersion(options) {
  const runNumber = requireValue(options.runNumber, "runNumber");
  const runAttempt = requireValue(options.runAttempt, "runAttempt");

  return `${CLI_RELEASE_BASE_VERSION}-dev.${runNumber}.${runAttempt}`;
}

export function resolvePrVersion(options) {
  const prNumber = requireValue(options.prNumber, "prNumber");
  const sha = shortSha(requireValue(options.sha, "sha"));

  return `${CLI_RELEASE_BASE_VERSION}-pr.${prNumber}.sha${sha}`;
}

export function resolveNextBetaVersion(latest) {
  const normalizedLatest = (latest ?? "").trim();

  if (!normalizedLatest || normalizedLatest.startsWith("2.")) {
    return `${CLI_RELEASE_BASE_VERSION}-beta.0`;
  }

  const betaMatch = normalizedLatest.match(/^3\.0\.0-beta\.(\d+)$/);
  if (betaMatch) {
    const nextNumber = Number(betaMatch[1]) + 1;
    return `${CLI_RELEASE_BASE_VERSION}-beta.${nextNumber}`;
  }

  throw new Error(
    `Cannot compute the next beta from npm latest (${normalizedLatest}). Expected no latest, a 2.x legacy latest, or ${CLI_RELEASE_BASE_VERSION}-beta.N.`,
  );
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

  if (command === "dev") {
    process.stdout.write(`version=${resolveDevVersion({
      runNumber: options["run-number"],
      runAttempt: options["run-attempt"],
    })}\n`);
    return;
  }

  if (command === "pr") {
    process.stdout.write(`version=${resolvePrVersion({
      prNumber: options["pr-number"],
      sha: options.sha,
    })}\n`);
    return;
  }

  if (command === "next-beta") {
    const latest = options.latest ?? "";
    process.stdout.write(`latest=${latest}\n`);
    process.stdout.write(`version=${resolveNextBetaVersion(latest)}\n`);
    return;
  }

  throw new Error("Usage: resolve-cli-version.mjs <dev|pr|next-beta> [options]");
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
