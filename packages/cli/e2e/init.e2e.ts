/**
 * `prisma init` needs no credential: it edits package.json and syncs
 * skills from installed packages, so it runs here whether or not the
 * real-API suite has a token. Covered as an e2e-coverage EXCLUSIONS
 * entry, because `describeCommand` skips without credentials and this
 * must not.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLI_BINARY } from "./harness";

const execFileAsync = promisify(execFile);

interface InitEnvelope {
  readonly ok: boolean;
  readonly result: {
    readonly postinstall: {
      readonly outcome: string;
      readonly script: string | null;
    };
    readonly skills: {
      readonly outcome: string;
      readonly sync: { readonly packages: readonly unknown[] } | null;
    };
  };
}

async function runInit(cwd: string): Promise<InitEnvelope> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [CLI_BINARY, "init", "--json"],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        HOME: cwd,
        USERPROFILE: cwd,
        PRISMA_NEXT_DISABLE_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
        CI: "1",
      },
      timeout: 60_000,
    },
  );
  const frames = stdout
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as { kind?: string; envelope?: unknown });
  const result = frames.reverse().find((frame) => frame.kind === "result");
  if (result?.envelope === undefined) {
    throw new Error(`no terminal result frame in:\n${stdout.slice(0, 2000)}`);
  }
  return result.envelope as InitEnvelope;
}

describe("prisma init", () => {
  let workdir: string;

  beforeAll(async () => {
    workdir = await mkdtemp(path.join(os.tmpdir(), "prisma-e2e-init-"));
    await writeFile(
      path.join(workdir, "package.json"),
      `${JSON.stringify({ name: "e2e-init-fixture", version: "0.0.0" }, null, 2)}\n`,
      "utf8",
    );
  });

  afterAll(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("adds the postinstall hook and finds no skills to sync", async () => {
    const envelope = await runInit(workdir);

    expect(envelope.ok).toBe(true);
    expect(envelope.result.postinstall.outcome).toBe("added");
    expect(envelope.result.postinstall.script).toBe(
      "prisma skills sync || exit 0",
    );
    // No allowlisted Prisma package is installed here, so the sync has
    // nothing to do and says so instead of failing.
    expect(envelope.result.skills.outcome).toBe("up-to-date");
    expect(envelope.result.skills.sync?.packages).toEqual([]);

    const manifest = JSON.parse(
      await readFile(path.join(workdir, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(manifest.scripts?.postinstall).toBe("prisma skills sync || exit 0");
  });

  it("reruns idempotently", async () => {
    const envelope = await runInit(workdir);

    expect(envelope.ok).toBe(true);
    expect(envelope.result.postinstall.outcome).toBe("exists");
    expect(envelope.result.skills.outcome).toBe("up-to-date");
  });
});
