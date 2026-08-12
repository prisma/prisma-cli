// biome-ignore-all lint/performance/useTopLevelRegex: Existing executable detection regex is kept inline for readability.
import { createRequire } from "node:module";

import { CLI_NAME } from "../cli-name";

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
    // The v8 bin builds the CLI before it can present anything, and
    // prints a construction failure as one plain stderr line, so this
    // carries its whole explanation in the message.
    throw new Error(
      "CLI version metadata is missing from the installed package: the bundled package.json could not be read or did not contain a version field. Reinstall the CLI from the npm registry, or check your install path is intact.",
    );
  }

  return pkg.version;
}

// Published bin name is the agreed user-facing identifier for the preview.
// The bin name and the npm package name differ: the npm package is
// "@prisma/cli", but the binary on PATH is CLI_NAME.
export function getCliName(): string {
  return CLI_NAME;
}
