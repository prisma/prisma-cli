import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const BETA_BASE_ERROR =
  /Cannot compute the next beta from npm latest \(0\.1\.0\)\./;
const USAGE_LINE = /Usage: resolve-package-version\.mjs <dev\|next-beta>/;

// The script is exercised as a subprocess, exactly as CI invokes it
// (`node scripts/resolve-package-version.mjs ...`). Base version 0.1.0 is
// resolved from `packages/compute` — the one remaining consumer
// (`publish-compute.yml`); the manifest carries `0.1.0-beta.0` and the
// base derivation strips the pre-release suffix.
const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const scriptPath = path.join(repoRoot, "scripts/resolve-package-version.mjs");

async function runScript(args) {
  try {
    // The command must stay first; option flags follow in any order.
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      scriptPath,
      ...args,
      "--package-dir",
      "packages/compute",
    ]);
    return { stdout, stderr, failed: false };
  } catch (error) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      failed: true,
    };
  }
}

describe("resolve package version (compute)", () => {
  it("computes the first beta when npm latest is missing", async () => {
    assert.deepEqual(await runScript(["next-beta", "--latest", ""]), {
      stdout: "latest=\nversion=0.1.0-beta.0\n",
      stderr: "",
      failed: false,
    });
  });

  it("increments the beta number from the current npm latest", async () => {
    assert.deepEqual(
      await runScript(["next-beta", "--latest", "0.1.0-beta.0"]),
      {
        stdout: "latest=0.1.0-beta.0\nversion=0.1.0-beta.1\n",
        stderr: "",
        failed: false,
      },
    );
  });

  it("fails when npm latest is outside the supported beta line", async () => {
    const result = await runScript(["next-beta", "--latest", "0.1.0"]);
    assert.equal(result.failed, true);
    assert.match(result.stderr, BETA_BASE_ERROR);
  });

  it("computes a unique dev build version", async () => {
    assert.deepEqual(
      await runScript(["dev", "--run-number", "123", "--run-attempt", "2"]),
      {
        stdout: "version=0.1.0-dev.123.2\n",
        stderr: "",
        failed: false,
      },
    );
  });

  it("rejects the retired pr command", async () => {
    const result = await runScript([
      "pr",
      "--pr-number",
      "43",
      "--sha",
      "f1110dd704a9",
    ]);
    assert.equal(result.failed, true);
    assert.match(result.stderr, USAGE_LINE);
  });
});
