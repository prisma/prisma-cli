import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalizeWindowsPathKey } from "../src/shell/path-env";

// Guards the end-to-end failure path the fix exists for:
//   process.env  ->  spread/copy  ->  PATH rewrite  ->  spawned child
// The compute SDK builds a local build subprocess exactly this way — it
// spreads the inherited env and prepends `node_modules/.bin` to PATH — so we
// reproduce that env shape here and assert a real child can still resolve a
// binary on the inherited path (the `bun` the report could not find).

const isWindows = process.platform === "win32";

/**
 * Mirrors `@prisma/compute-sdk`'s `buildCommandEnv`: spread the inherited env
 * into a plain object, then rebuild PATH with extra bin dirs prepended. This
 * is the operation that silently truncates PATH when the inherited key is the
 * Windows-native `Path` rather than `PATH`.
 */
function buildCommandEnvLikeSdk(
  baseEnv: NodeJS.ProcessEnv,
  binDirs: string[],
): NodeJS.ProcessEnv {
  const spread = { ...baseEnv };
  return {
    ...spread,
    PATH: [...binDirs, spread.PATH].filter(Boolean).join(path.delimiter),
  };
}

function runCommandInShell(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], { cwd, env, shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("local build env resolves binaries (integration)", () => {
  let workdir: string;
  let binDir: string;
  const binaryName = "faux-bun";

  beforeEach(async () => {
    workdir = await mkdtemp(path.join(os.tmpdir(), "prisma-path-env-"));
    binDir = path.join(workdir, "tools");
    await mkdir(binDir, { recursive: true });

    if (isWindows) {
      // A .cmd shim is what a real installer drops on Windows.
      await writeFile(
        path.join(binDir, `${binaryName}.cmd`),
        "@echo faux-bun-ran\r\n",
      );
    } else {
      const script = path.join(binDir, binaryName);
      await writeFile(script, "#!/bin/sh\necho faux-bun-ran\n");
      await chmod(script, 0o755);
    }
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("spawns a child that finds a binary on the inherited path after the SDK-style rewrite", async () => {
    // Inherit the real environment, but place our binary dir on the path
    // under the OS-native key: `Path` on Windows (where the bug lives), the
    // canonical `PATH` elsewhere.
    const baseEnv: NodeJS.ProcessEnv = { ...process.env };
    const pathKey = isWindows ? "Path" : "PATH";
    const existingPath = process.env.PATH ?? "";
    delete baseEnv.PATH;
    delete baseEnv.Path;
    baseEnv[pathKey] = [binDir, existingPath]
      .filter(Boolean)
      .join(path.delimiter);

    // The fix: normalize before the env is spread for the subprocess.
    canonicalizeWindowsPathKey(baseEnv);

    // The node_modules/.bin dir the SDK prepends; empty here, but it forces the
    // PATH rewrite that dropped inherited entries in the reported failure.
    const childEnv = buildCommandEnvLikeSdk(baseEnv, [
      path.join(workdir, "node_modules", ".bin"),
    ]);

    const result = await runCommandInShell(binaryName, childEnv, workdir);

    expect(result.stdout.trim()).toBe("faux-bun-ran");
    expect(result.code).toBe(0);
  });
});
