import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  resolveDevVersion,
  resolveNextBetaVersion,
  resolvePrVersion,
} from "../../../scripts/resolve-cli-version.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const scriptPath = path.join(repoRoot, "scripts/resolve-cli-version.mjs");

describe("resolve cli version", () => {
  it("computes the first beta when npm latest is missing or still legacy 2.x", () => {
    expect(resolveNextBetaVersion("")).toBe("3.0.0-beta.0");
    expect(resolveNextBetaVersion("2.20.1")).toBe("3.0.0-beta.0");
  });

  it("increments the beta number from the current npm latest", () => {
    expect(resolveNextBetaVersion("3.0.0-beta.0")).toBe("3.0.0-beta.1");
  });

  it("fails when npm latest is outside the supported beta line", () => {
    expect(() => resolveNextBetaVersion("3.0.0")).toThrow(
      "Cannot compute the next beta from npm latest (3.0.0).",
    );
  });

  it("computes a unique dev build version", () => {
    expect(
      resolveDevVersion({
        runNumber: "123",
        runAttempt: "2",
      }),
    ).toBe("3.0.0-dev.123.2");
  });

  it("computes an exact PR preview version", () => {
    expect(
      resolvePrVersion({
        prNumber: "43",
        sha: "f1110dd704a9382c429b",
      }),
    ).toBe("3.0.0-pr.43.shaf1110dd704a9");
  });

  it("prints GitHub output lines for the next beta command", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "next-beta",
      "--latest",
      "3.0.0-beta.0",
    ]);

    expect(stdout).toBe("latest=3.0.0-beta.0\nversion=3.0.0-beta.1\n");
  });
});
