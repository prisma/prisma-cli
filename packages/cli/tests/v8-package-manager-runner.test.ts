/**
 * The bin's half of Runtime.runPackageManager. It is the only place on
 * the v8 engine that spawns a package manager; the legacy commander
 * shell still spawns its own (src/controllers/init.ts and
 * src/lib/agent/package-manager.ts) until S2d retires it. Driven
 * against real child processes, because what is being asserted is how a
 * real child's output, exit code, and death reach the engine.
 */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPackageManager } from "../src/v8/package-manager-runner";

const NODE = process.execPath;

type Chunk = [channel: "data" | "diagnostic", text: string];

function collect(): { chunks: Chunk[]; onOutput: (...chunk: Chunk) => void } {
  const chunks: Chunk[] = [];
  return {
    chunks,
    onOutput: (channel, text) => {
      chunks.push([channel, text]);
    },
  };
}

function joined(chunks: readonly Chunk[], channel: Chunk[0]): string {
  return chunks
    .filter(([seen]) => seen === channel)
    .map(([, text]) => text)
    .join("");
}

describe("runPackageManager", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "pm-runner-")));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs the composed file and args in the given cwd", async () => {
    const { chunks, onOutput } = collect();

    const result = await runPackageManager({
      file: NODE,
      args: ["-e", "process.stdout.write(process.cwd())", "--", "add", "-D"],
      cwd: dir,
      signal: new AbortController().signal,
      onOutput,
    });

    expect(result).toEqual({ exitCode: 0, stderr: "" });
    expect(joined(chunks, "data")).toBe(dir);
  });

  it("streams stdout and stderr in the order the child writes them", async () => {
    const { chunks, onOutput } = collect();

    const result = await runPackageManager({
      file: NODE,
      args: [
        "-e",
        `process.stdout.write("resolving\\n");
         setTimeout(() => {
           process.stderr.write("WARN peer\\n");
           setTimeout(() => {
             process.stdout.write("done\\n");
             process.exitCode = 3;
           }, 20);
         }, 20);`,
      ],
      cwd: dir,
      signal: new AbortController().signal,
      onOutput,
    });

    expect(chunks).toEqual([
      ["data", "resolving\n"],
      ["diagnostic", "WARN peer\n"],
      ["data", "done\n"],
    ]);
    expect(result).toEqual({ exitCode: 3, stderr: "WARN peer\n" });
  });

  it("a non-zero exit is a result, not a throw", async () => {
    const { onOutput } = collect();

    await expect(
      runPackageManager({
        file: NODE,
        args: [
          "-e",
          `process.stderr.write("ERR_PNPM_NO_MATCHING_VERSION");
           process.exitCode = 9;`,
        ],
        cwd: dir,
        signal: new AbortController().signal,
        onOutput,
      }),
    ).resolves.toEqual({
      exitCode: 9,
      stderr: "ERR_PNPM_NO_MATCHING_VERSION",
    });
  });

  it("keeps the last 64 KiB of stderr while streaming all of it", async () => {
    const { chunks, onOutput } = collect();

    const result = await runPackageManager({
      file: NODE,
      args: [
        "-e",
        `process.stderr.write("HEAD" + "x\\n".repeat(50 * 1024) + "TAIL");
         process.exitCode = 1;`,
      ],
      cwd: dir,
      signal: new AbortController().signal,
      onOutput,
    });

    expect(result.exitCode).toBe(1);
    expect(Buffer.byteLength(result.stderr)).toBeGreaterThan(64 * 1024 - 4);
    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(64 * 1024);
    expect(result.stderr.endsWith("TAIL")).toBe(true);
    expect(result.stderr).not.toContain("HEAD");
    expect(joined(chunks, "diagnostic")).toHaveLength(100 * 1024 + 8);
  });

  it("a cut inside a URL's scheme leaves no bare userinfo in the tail", async () => {
    const { onOutput } = collect();
    // Redaction recognises a URL by its scheme, so what the 64 KiB cut
    // must never hand over is a line beginning "ci:s3cret@host/…".
    const url = "https://ci:s3cret@registry.acme.dev/prisma";
    const exposed = url.slice("https://".length);
    const trailerBytes = 64 * 1024 - exposed.length - 1;
    const trailer = "npm ERR! detail\n".repeat(4200).slice(0, trailerBytes);

    const result = await runPackageManager({
      file: NODE,
      args: [
        "-e",
        `process.stderr.write("npm ERR! 401 ${url}\\n" +
           "npm ERR! detail\\n".repeat(4200).slice(0, ${String(trailerBytes)}));
         process.exitCode = 1;`,
      ],
      cwd: dir,
      signal: new AbortController().signal,
      onOutput,
    });

    expect(result.stderr).not.toContain("s3cret");
    expect(result.stderr).toBe(trailer);
  });

  it("output with no line break at all yields no tail rather than a partial line", async () => {
    const { onOutput } = collect();

    const result = await runPackageManager({
      file: NODE,
      args: [
        "-e",
        `process.stderr.write("https://ci:s3cret@registry.acme.dev/" +
           "x".repeat(70 * 1024));
         process.exitCode = 1;`,
      ],
      cwd: dir,
      signal: new AbortController().signal,
      onOutput,
    });

    expect(result.stderr).toBe("");
  });

  it("decodes a multi-byte character split across two chunks", async () => {
    const { chunks, onOutput } = collect();

    await runPackageManager({
      file: NODE,
      args: [
        "-e",
        `const check = Buffer.from("\\u2713", "utf8");
         process.stdout.write(check.subarray(0, 1));
         setTimeout(() => process.stdout.write(check.subarray(1)), 20);`,
      ],
      cwd: dir,
      signal: new AbortController().signal,
      onOutput,
    });

    expect(joined(chunks, "data")).toBe("✓");
  });

  it("a missing executable is a result carrying a non-zero exit code", async () => {
    const { onOutput } = collect();

    const result = await runPackageManager({
      file: "prisma-no-such-package-manager",
      args: ["add", "prisma"],
      cwd: dir,
      signal: new AbortController().signal,
      onOutput,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("prisma-no-such-package-manager");
  });

  it("an abort kills the child rather than waiting it out", async () => {
    const { onOutput } = collect();
    const controller = new AbortController();

    const running = runPackageManager({
      file: NODE,
      args: [
        "-e",
        `process.stdout.write("started"); setTimeout(() => {}, 300000);`,
      ],
      cwd: dir,
      signal: controller.signal,
      onOutput,
    });
    setTimeout(() => controller.abort(new Error("cancelled")), 50);

    const result = await running;

    expect(result.exitCode).not.toBe(0);
    expect(controller.signal.aborted).toBe(true);
  });
});
