import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamEvent } from "@prisma/cli-engine";
import { afterAll, describe, expect, it } from "vitest";
import { buildCli, mountedCommands } from "../src/cli";
import { assembleRuntime, type HostProcess } from "../src/runtime";

const WORK_DIR = mkdtempSync(join(tmpdir(), "v7-inventory-"));
const CONFIG_HOME = join(WORK_DIR, "config-home");
const WHITESPACE = /\s+/;
const INSTALL = "npm install --save-dev @prisma/prisma7@7";
const NPX = /\bnpx\b/;

const V7_COMMANDS = [
  "bootstrap",
  "version",
  "debug",
  "mcp",
  "complete",
  "platform status",
  "postgres link",
  "migrate dev",
  "migrate deploy",
  "migrate status",
  "migrate diff",
  "migrate reset",
  "migrate resolve",
  "generate",
  "validate",
  "format",
  "studio",
  "db pull",
  "db push",
  "db seed",
  "db execute",
  "dev ls",
  "dev rm",
  "dev start",
] as const;

const V7_FLAGS = [
  "init --db",
  "init --no-skills",
  "init --datasource-provider x",
  "init --generator-provider x",
  "init --preview-feature x",
  "init --output x",
  "init --url x",
  "init --with-model",
  "dev --port 1",
  "dev --db-port 1",
  "dev --shadow-db-port 1",
  "dev --debug",
  "dev stop --debug",
] as const;

const CASES: readonly (readonly [string, string])[] = [
  ...V7_COMMANDS.map((path) => [path, "CLI.V7_COMMAND"] as const),
  ...V7_FLAGS.map((invocation) => [invocation, "CLI.V7_FLAG"] as const),
];

afterAll(() => {
  rmSync(WORK_DIR, { recursive: true, force: true });
});

function makeProcess(argv: readonly string[]) {
  const proc = {
    argv: ["node", "bin.js", ...argv],
    version: "v22.12.0",
    versions: { node: "22.12.0" },
    platform: "linux",
    arch: "x64",
    env: {
      PRISMA_DISABLE_TELEMETRY: "1",
      XDG_CONFIG_HOME: CONFIG_HOME,
      APPDATA: CONFIG_HOME,
    },
    cwd: () => WORK_DIR,
    stdoutText: "",
    stderrText: "",
    stdout: {
      isTTY: false,
      write(text: string) {
        proc.stdoutText += text;
      },
    },
    stderr: {
      isTTY: false,
      write(text: string) {
        proc.stderrText += text;
      },
    },
    stdin: {
      isTTY: false,
      async *[Symbol.asyncIterator]() {},
    } as unknown as HostProcess["stdin"],
    on() {
      return proc;
    },
    off() {
      return proc;
    },
    exit(code: number): never {
      throw new Error(`process.exit(${code})`);
    },
  };
  return proc;
}

async function run(argv: readonly string[]) {
  const proc = makeProcess(argv);
  const runtime = await assembleRuntime(proc as unknown as HostProcess);
  const exitCode = await buildCli().run(argv, runtime);
  return { exitCode, stdout: proc.stdoutText, stderr: proc.stderrText };
}

function failedEnvelope(stdout: string) {
  const frames = stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as StreamEvent);
  const last = frames.at(-1);
  if (last?.kind !== "result" || last.envelope.ok) {
    throw new Error(`expected a failed result frame, got: ${stdout}`);
  }
  return last.envelope;
}

function commandPath(command: string): string {
  const words = command.split(WHITESPACE);
  expect(words[0]).toBe("prisma");
  const path: string[] = [];
  for (const word of words.slice(1)) {
    if (word.startsWith("-") || word.startsWith("<")) {
      break;
    }
    path.push(word);
  }
  return path.join(" ");
}

describe("every Prisma 7 command path and flag settles as the v7 error", () => {
  it.each(CASES)("`prisma %s` settles as %s", async (invocation, code) => {
    const args = invocation.split(" ");

    const json = await run([...args, "--json"]);
    expect(json.exitCode).toBe(2);
    const error = failedEnvelope(json.stdout).error;
    expect(error.code).toBe(code);
    expect(error.why).toContain(INSTALL);
    expect(error.why).toContain("prisma7 ");
    expect(error.why).not.toMatch(NPX);
    expect(error.nextActions.length).toBeGreaterThan(0);

    const paths = error.nextActions
      .map((action) => action.command)
      .filter((command) => command !== undefined)
      .filter((command) => command !== "prisma --version")
      .map(commandPath);
    for (const path of paths) {
      expect(Object.keys(mountedCommands)).toContain(path);
    }
    const helps = await Promise.all(
      paths.map((path) => run([...path.split(" "), "--help"])),
    );
    for (const target of helps) {
      expect(target.exitCode).toBe(0);
      expect(target.stdout + target.stderr).not.toContain(
        "CLI.UNKNOWN_COMMAND",
      );
      expect(target.stdout + target.stderr).not.toContain("CLI.V7_");
    }

    const human = await run(args);
    expect(human.exitCode).toBe(2);
    const output = human.stdout + human.stderr;
    for (const action of error.nextActions) {
      expect(output).toContain(action.command ?? action.url);
    }
  });
});
