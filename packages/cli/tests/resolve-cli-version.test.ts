import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The script is exercised as a subprocess, exactly as CI invokes it. Tests
// never import it: out-of-root shebang scripts break the Windows transform.
const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const scriptPath = path.join(repoRoot, "scripts/resolve-cli-version.mjs");

async function runScript(args: string[]): Promise<{ stdout: string; stderr: string; failed: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args]);
    return { stdout, stderr, failed: false };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", failed: true };
  }
}

describe("resolve cli version", () => {
  it("computes the first beta when npm latest is missing or still legacy 2.x", async () => {
    await expect(runScript(["next-beta", "--latest", ""])).resolves.toMatchObject({
      stdout: "latest=\nversion=3.0.0-beta.0\n",
      failed: false,
    });
    await expect(runScript(["next-beta", "--latest", "2.20.1"])).resolves.toMatchObject({
      stdout: "latest=2.20.1\nversion=3.0.0-beta.0\n",
      failed: false,
    });
  });

  it("increments the beta number from the current npm latest", async () => {
    await expect(runScript(["next-beta", "--latest", "3.0.0-beta.0"])).resolves.toMatchObject({
      stdout: "latest=3.0.0-beta.0\nversion=3.0.0-beta.1\n",
      failed: false,
    });
  });

  it("fails when npm latest is outside the supported beta line", async () => {
    const result = await runScript(["next-beta", "--latest", "3.0.0"]);
    expect(result.failed).toBe(true);
    expect(result.stderr).toContain("Cannot compute the next beta from npm latest (3.0.0).");
  });

  it("computes a unique dev build version", async () => {
    await expect(runScript(["dev", "--run-number", "123", "--run-attempt", "2"])).resolves.toMatchObject({
      stdout: "version=3.0.0-dev.123.2\n",
      failed: false,
    });
  });

  it("computes an exact PR preview version", async () => {
    await expect(runScript(["pr", "--pr-number", "43", "--sha", "f1110dd704a9382c429b"])).resolves.toMatchObject({
      stdout: "version=3.0.0-pr.43.shaf1110dd704a9\n",
      failed: false,
    });
  });

  it("prints GitHub output lines for the next beta command", async () => {
    await expect(runScript(["next-beta", "--latest", "3.0.0-beta.0"])).resolves.toMatchObject({
      stdout: "latest=3.0.0-beta.0\nversion=3.0.0-beta.1\n",
    });
  });
});
