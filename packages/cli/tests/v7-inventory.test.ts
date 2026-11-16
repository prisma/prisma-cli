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

type InstallForm = "keep" | "migrations";

interface V7Case {
  readonly invocation: string;
  readonly code: "CLI.V7_COMMAND" | "CLI.V7_FLAG";
  readonly prisma7: string;
  readonly form: InstallForm;
}

const CASES: readonly V7Case[] = [
  {
    invocation: "bootstrap",
    code: "CLI.V7_COMMAND",
    prisma7: "bootstrap",
    form: "keep",
  },
  {
    invocation: "version",
    code: "CLI.V7_COMMAND",
    prisma7: "version",
    form: "keep",
  },
  {
    invocation: "debug",
    code: "CLI.V7_COMMAND",
    prisma7: "debug",
    form: "keep",
  },
  {
    invocation: "mcp",
    code: "CLI.V7_COMMAND",
    prisma7: "mcp",
    form: "keep",
  },
  {
    invocation: "complete",
    code: "CLI.V7_COMMAND",
    prisma7: "complete <shell>",
    form: "keep",
  },
  {
    invocation: "platform status",
    code: "CLI.V7_COMMAND",
    prisma7: "platform status",
    form: "keep",
  },
  {
    invocation: "postgres link",
    code: "CLI.V7_COMMAND",
    prisma7: "postgres link",
    form: "keep",
  },
  {
    invocation: "migrate dev",
    code: "CLI.V7_COMMAND",
    prisma7: "migrate dev",
    form: "migrations",
  },
  {
    invocation: "migrate deploy",
    code: "CLI.V7_COMMAND",
    prisma7: "migrate deploy",
    form: "migrations",
  },
  {
    invocation: "migrate status",
    code: "CLI.V7_COMMAND",
    prisma7: "migrate status",
    form: "migrations",
  },
  {
    invocation: "migrate diff",
    code: "CLI.V7_COMMAND",
    prisma7: "migrate diff --from-config-datasource --to-schema <path>",
    form: "keep",
  },
  {
    invocation: "migrate reset",
    code: "CLI.V7_COMMAND",
    prisma7: "migrate reset",
    form: "migrations",
  },
  {
    invocation: "migrate resolve",
    code: "CLI.V7_COMMAND",
    prisma7: "migrate resolve --applied <migration>",
    form: "migrations",
  },
  {
    invocation: "generate",
    code: "CLI.V7_COMMAND",
    prisma7: "generate",
    form: "keep",
  },
  {
    invocation: "validate",
    code: "CLI.V7_COMMAND",
    prisma7: "validate",
    form: "keep",
  },
  {
    invocation: "format",
    code: "CLI.V7_COMMAND",
    prisma7: "format",
    form: "keep",
  },
  {
    invocation: "studio",
    code: "CLI.V7_COMMAND",
    prisma7: "studio",
    form: "keep",
  },
  {
    invocation: "db pull",
    code: "CLI.V7_COMMAND",
    prisma7: "db pull",
    form: "keep",
  },
  {
    invocation: "db push",
    code: "CLI.V7_COMMAND",
    prisma7: "db push",
    form: "keep",
  },
  {
    invocation: "db seed",
    code: "CLI.V7_COMMAND",
    prisma7: "db seed",
    form: "keep",
  },
  {
    invocation: "db execute",
    code: "CLI.V7_COMMAND",
    prisma7: "db execute --file <path>",
    form: "keep",
  },
  {
    invocation: "dev ls",
    code: "CLI.V7_COMMAND",
    prisma7: "dev ls",
    form: "keep",
  },
  {
    invocation: "dev rm",
    code: "CLI.V7_COMMAND",
    prisma7: "dev rm <name>",
    form: "keep",
  },
  {
    invocation: "dev start",
    code: "CLI.V7_COMMAND",
    prisma7: "dev start <name>",
    form: "keep",
  },
  {
    invocation: "init --db",
    code: "CLI.V7_FLAG",
    prisma7: "init --db",
    form: "keep",
  },
  {
    invocation: "init --no-skills",
    code: "CLI.V7_FLAG",
    prisma7: "init --no-skills",
    form: "keep",
  },
  {
    invocation: "init --datasource-provider x",
    code: "CLI.V7_FLAG",
    prisma7: "init --datasource-provider <provider>",
    form: "keep",
  },
  {
    invocation: "init --generator-provider x",
    code: "CLI.V7_FLAG",
    prisma7: "init --generator-provider <provider>",
    form: "keep",
  },
  {
    invocation: "init --preview-feature x",
    code: "CLI.V7_FLAG",
    prisma7: "init --preview-feature <feature>",
    form: "keep",
  },
  {
    invocation: "init --output x",
    code: "CLI.V7_FLAG",
    prisma7: "init --output <path>",
    form: "keep",
  },
  {
    invocation: "init --url x",
    code: "CLI.V7_FLAG",
    prisma7: "init --url <url>",
    form: "keep",
  },
  {
    invocation: "init --with-model",
    code: "CLI.V7_FLAG",
    prisma7: "init --with-model",
    form: "keep",
  },
  {
    invocation: "dev --port 1",
    code: "CLI.V7_FLAG",
    prisma7: "dev --port <port>",
    form: "keep",
  },
  {
    invocation: "dev --db-port 1",
    code: "CLI.V7_FLAG",
    prisma7: "dev --db-port <port>",
    form: "keep",
  },
  {
    invocation: "dev --shadow-db-port 1",
    code: "CLI.V7_FLAG",
    prisma7: "dev --shadow-db-port <port>",
    form: "keep",
  },
  {
    invocation: "dev --debug",
    code: "CLI.V7_FLAG",
    prisma7: "dev --debug",
    form: "keep",
  },
  {
    invocation: "dev stop --debug",
    code: "CLI.V7_FLAG",
    prisma7: "dev stop <name> --debug",
    form: "keep",
  },
];

function installSentence(prisma7: string, form: InstallForm): string {
  return form === "migrations"
    ? `While Prisma 7 still owns this project's migrations, install its CLI with \`${INSTALL}\` and run \`prisma7 ${prisma7}\` instead.`
    : `To keep using Prisma 7, install its CLI with \`${INSTALL}\` and run \`prisma7 ${prisma7}\`.`;
}

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
  it.each(CASES)("`prisma $invocation` settles as $code", async ({
    invocation,
    code,
    prisma7,
    form,
  }) => {
    const args = invocation.split(" ");

    const json = await run([...args, "--json"]);
    expect(json.exitCode).toBe(2);
    const error = failedEnvelope(json.stdout).error;
    expect(error.code).toBe(code);
    const sentence = ` ${installSentence(prisma7, form)}`;
    expect(error.why?.slice(-sentence.length)).toBe(sentence);
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
