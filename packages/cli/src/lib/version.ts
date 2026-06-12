import { createRequire } from "node:module";
import process from "node:process";

import { CliError } from "../shell/errors";
import type { VersionInvocation, VersionResult } from "../types/version";

interface PackageMetadata {
  name?: string;
  version?: string;
}

const requireFromHere = createRequire(import.meta.url);

function readPackageMetadata(): PackageMetadata {
  try {
    return requireFromHere("../../package.json") as PackageMetadata;
  } catch {
    return {};
  }
}

export function getCliVersion(): string {
  const pkg = readPackageMetadata();

  if (!pkg.version) {
    throw new CliError({
      code: "VERSION_UNAVAILABLE",
      domain: "cli",
      summary: "CLI version metadata is missing from the installed package",
      why: "The bundled package.json could not be read or did not contain a version field.",
      fix: "Reinstall the CLI from the npm registry, or check your install path is intact.",
      exitCode: 1,
    });
  }

  return pkg.version;
}

// Published bin name is the agreed user-facing identifier for the preview.
// We hard-code "prisma-cli" because the bin name and the npm package name differ:
// the npm package is "@prisma/cli", but the binary on PATH is "prisma-cli".
export function getCliName(): string {
  return "prisma-cli";
}

export function detectInvocation(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): VersionInvocation {
  if (env.npm_config_user_agent?.startsWith("bun")) {
    return "bunx";
  }

  const normalizedExecPath = env.npm_execpath
    ?.replace(/\\/g, "/")
    .toLowerCase();
  const normalizedUserAgent = env.npm_config_user_agent?.toLowerCase();

  if (
    env.npm_lifecycle_event === "npx" ||
    normalizedExecPath?.includes("/_npx/") ||
    normalizedUserAgent?.includes("npx")
  ) {
    return "npx";
  }

  const entry = (argv[1] ?? "").replace(/\\/g, "/").toLowerCase();

  if (entry.endsWith(".ts") || entry.includes("/tsx/")) {
    return "dev";
  }

  if (entry.includes("/_npx/")) {
    return "npx";
  }

  if (entry.includes("/.bun/")) {
    return "bunx";
  }

  if (
    entry.includes("/node_modules/.bin/") ||
    /\/prisma-cli(\.cmd|\.exe)?$/.test(entry)
  ) {
    return "global";
  }

  return "unknown";
}

export function buildVersionResult(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): VersionResult {
  return {
    cli: {
      name: getCliName(),
      version: getCliVersion(),
    },
    node: {
      version: process.version,
    },
    os: {
      platform: process.platform,
      arch: process.arch,
    },
    invocation: detectInvocation(env, argv),
  };
}
