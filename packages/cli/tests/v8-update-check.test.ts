/**
 * v8 bin wiring of the update check: the cached notification (and the
 * detached refresh spawn) runs inside main() before the command
 * dispatches, with the legacy shell's sequencing and suppression rules.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCliVersion } from "../src/lib/version";
import { UpdateCheckStore } from "../src/update-check";
import { main } from "../src/v8/main";
import type { HostProcess } from "../src/v8/runtime";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

function makeProcess(overrides: {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  stderrTty?: boolean;
}): HostProcess & { stdoutText: string; stderrText: string } {
  const proc = {
    argv: overrides.argv ?? ["node", "bin.js", "auth", "whoami"],
    env: overrides.env ?? {},
    cwd: () => "/tmp/v8-update-check-cwd",
    stdoutText: "",
    stderrText: "",
    stdout: {
      isTTY: true,
      write(text: string) {
        proc.stdoutText += text;
      },
    },
    stderr: {
      isTTY: overrides.stderrTty ?? true,
      write(text: string) {
        proc.stderrText += text;
      },
    },
    stdin: {
      isTTY: false,
      async *[Symbol.asyncIterator]() {},
    } as unknown as HostProcess["stdin"],
    on: () => proc,
    off: () => proc,
    exit(code: number): never {
      throw new Error(`process.exit(${code})`);
    },
  };
  return proc;
}

const stubCli = () => ({ run: async () => 0 });

async function makeUpdateCheckDir(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "v8-update-check-"));
}

function nextMajorVersion(): string {
  const [major] = getCliVersion().split(".");
  return `${Number(major) + 1}.0.0`;
}

async function seedStaleUpdate(updateCheckDir: string): Promise<void> {
  await new UpdateCheckStore(updateCheckDir).write({
    packageName: "@prisma/cli",
    installedVersion: getCliVersion(),
    latestVersion: nextMajorVersion(),
    checkedAt: new Date().toISOString(),
  });
}

function updateCheckEnv(updateCheckDir: string): NodeJS.ProcessEnv {
  return { PRISMA_CLI_UPDATE_CHECK_DIR: updateCheckDir };
}

beforeEach(() => {
  vi.mocked(spawn).mockClear();
});

describe("v8 main update-check wiring", () => {
  it("prints the cached update notice to stderr before dispatching", async () => {
    const updateCheckDir = await makeUpdateCheckDir();
    await seedStaleUpdate(updateCheckDir);
    const proc = makeProcess({ env: updateCheckEnv(updateCheckDir) });

    const exitCode = await main(proc, stubCli);

    expect(exitCode).toBe(0);
    expect(proc.stderrText).toContain(
      `Update available: prisma-cli ${getCliVersion()} -> ${nextMajorVersion()}`,
    );
    expect(proc.stdoutText).toBe("");
  });

  it("stays silent inside the notification interval", async () => {
    const updateCheckDir = await makeUpdateCheckDir();
    await seedStaleUpdate(updateCheckDir);
    const env = updateCheckEnv(updateCheckDir);

    const first = makeProcess({ env });
    await main(first, stubCli);
    const second = makeProcess({ env });
    await main(second, stubCli);

    expect(first.stderrText).toContain("Update available");
    expect(second.stderrText).not.toContain("Update available");
  });

  it("stays silent in json mode (legacy behavior, copied)", async () => {
    const updateCheckDir = await makeUpdateCheckDir();
    await seedStaleUpdate(updateCheckDir);
    const proc = makeProcess({
      argv: ["node", "bin.js", "auth", "whoami", "--json"],
      env: updateCheckEnv(updateCheckDir),
    });

    await main(proc, stubCli);

    expect(proc.stderrText).not.toContain("Update available");
  });

  it("stays silent without a stderr TTY", async () => {
    const updateCheckDir = await makeUpdateCheckDir();
    await seedStaleUpdate(updateCheckDir);
    const proc = makeProcess({
      env: updateCheckEnv(updateCheckDir),
      stderrTty: false,
    });

    await main(proc, stubCli);

    expect(proc.stderrText).not.toContain("Update available");
  });

  it("spawns the detached refresh worker with the worker env contract", async () => {
    const updateCheckDir = await makeUpdateCheckDir();
    const proc = makeProcess({
      env: {
        ...updateCheckEnv(updateCheckDir),
        PRISMA_CLI_UPDATE_CHECK_REGISTRY_URL: "https://registry.test/pkg",
      },
    });

    await main(proc, stubCli);

    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
    const [execPath, args, options] = vi.mocked(spawn).mock.calls[0] as [
      string,
      string[],
      {
        detached: boolean;
        stdio: string;
        env: NodeJS.ProcessEnv;
      },
    ];
    expect(execPath).toBe(process.execPath);
    expect(args).toEqual([process.argv[1]]);
    expect(options.detached).toBe(true);
    expect(options.stdio).toBe("ignore");
    expect(options.env).toMatchObject({
      PRISMA_CLI_RUN_UPDATE_CHECK_WORKER: "1",
      PRISMA_CLI_UPDATE_CHECK_DIR: updateCheckDir,
      PRISMA_CLI_UPDATE_CHECK_INSTALLED_VERSION: getCliVersion(),
      PRISMA_CLI_UPDATE_CHECK_REGISTRY_URL: "https://registry.test/pkg",
    });
    const state = JSON.parse(
      await readFile(path.join(updateCheckDir, "update-check.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(state.checkedAt).toEqual(expect.any(String));
  });

  it("skips the refresh spawn inside the 24-hour discovery interval", async () => {
    const updateCheckDir = await makeUpdateCheckDir();
    await new UpdateCheckStore(updateCheckDir).write({
      packageName: "@prisma/cli",
      installedVersion: getCliVersion(),
      checkedAt: new Date().toISOString(),
    });
    const proc = makeProcess({ env: updateCheckEnv(updateCheckDir) });

    await main(proc, stubCli);

    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });
});
