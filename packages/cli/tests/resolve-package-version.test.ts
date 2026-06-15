import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

// The script is exercised as a subprocess, exactly as CI invokes it
// (`node scripts/resolve-package-version.mjs ...`). Importing it directly
// breaks on Windows: vitest hands the out-of-root shebang `.mjs` to native
// ESM, which rejects the `#!` line with a SyntaxError. Base version 3.0.0 is
// resolved from `packages/cli`, matching the package's current major line.
const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const scriptPath = path.join(repoRoot, "scripts/resolve-package-version.mjs");

async function runScript(
  args: string[],
): Promise<{ stdout: string; stderr: string; failed: boolean }> {
  try {
    // The command must stay first; option flags follow in any order.
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      scriptPath,
      ...args,
      "--package-dir",
      "packages/cli",
    ]);
    return { stdout, stderr, failed: false };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      failed: true,
    };
  }
}

describe("resolve package version", () => {
  it("computes the first beta when npm latest is missing or still legacy 2.x", async () => {
    await expect(
      runScript(["next-beta", "--latest", ""]),
    ).resolves.toMatchObject({
      stdout: "latest=\nversion=3.0.0-beta.0\n",
      failed: false,
    });
    await expect(
      runScript(["next-beta", "--latest", "2.20.1"]),
    ).resolves.toMatchObject({
      stdout: "latest=2.20.1\nversion=3.0.0-beta.0\n",
      failed: false,
    });
  });

  it("increments the beta number from the current npm latest", async () => {
    await expect(
      runScript(["next-beta", "--latest", "3.0.0-beta.0"]),
    ).resolves.toMatchObject({
      stdout: "latest=3.0.0-beta.0\nversion=3.0.0-beta.1\n",
      failed: false,
    });
  });

  it("fails when npm latest is outside the supported beta line", async () => {
    const result = await runScript(["next-beta", "--latest", "3.0.0"]);
    expect(result.failed).toBe(true);
    expect(result.stderr).toContain(
      "Cannot compute the next beta from npm latest (3.0.0).",
    );
  });

  it("computes a unique dev build version", async () => {
    await expect(
      runScript(["dev", "--run-number", "123", "--run-attempt", "2"]),
    ).resolves.toMatchObject({
      stdout: "version=3.0.0-dev.123.2\n",
      failed: false,
    });
  });

  it("computes an exact PR preview version", async () => {
    await expect(
      runScript(["pr", "--pr-number", "43", "--sha", "f1110dd704a9382c429b"]),
    ).resolves.toMatchObject({
      stdout: "version=3.0.0-pr.43.shaf1110dd704a9\n",
      failed: false,
    });
  });
});
