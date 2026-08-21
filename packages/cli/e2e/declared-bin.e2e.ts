/**
 * The bin the package DECLARES is the bin users get. Every other test
 * here hard-codes the built entry; this one starts from `package.json`'s
 * `bin` map, so a manifest pointing at the wrong tree fails even while
 * both trees still build. No credentials: `--version` must answer in a
 * bare environment on plain Node.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

const packageRoot = path.resolve(import.meta.dirname, "..");

describe("the declared bin", () => {
  it("maps prisma to the built CLI", () => {
    expect(packageJson.bin).toEqual({ "prisma-cli": "./dist/cli.js" });
  });

  it("prints the lockstep version on plain Node at exit 0", async () => {
    const declaredBin = path.resolve(
      packageRoot,
      packageJson.bin["prisma-cli"],
    );
    const { stdout } = await execFileAsync(
      process.execPath,
      [declaredBin, "--version"],
      {
        env: {
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
        },
        timeout: 60_000,
      },
    );
    // Piped stdout is not a TTY, so the shell answers in its JSON
    // stream; the terminal frame carries the version.
    const frame = JSON.parse(stdout.trim()) as {
      kind: string;
      envelope: { ok: boolean; result: { version: string } };
    };
    expect(frame.kind).toBe("result");
    expect(frame.envelope.ok).toBe(true);
    expect(frame.envelope.result.version).toBe(packageJson.version);
  });
});
