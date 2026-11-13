import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamEvent } from "@prisma/cli-engine";
import type { NextAction } from "@prisma/cli-engine/protocol";
import { describe, expect, it } from "vitest";
import { buildCli, mountedCommands } from "../src/cli";
import { CLI_DOCS_URL } from "../src/cli-name";
import { assembleRuntime, type HostProcess } from "../src/runtime";
import { v7CommandFamily } from "../src/v7-redirects";

const CONFIG_HOME = join(tmpdir(), "v7-redirects-test-config-home");
const UPPERCASE_LETTER = /[A-Z]/g;
const WHY_LINE = /^ {2}why: /;
const WHITESPACE = /\s+/;
const PRISMA_7 = /Prisma 7|prisma@7/;
const PRISMA_7_PACKAGE = /prisma@7|prisma7/;
const INSTALL_SENTENCE =
  / To keep using Prisma 7, install its CLI with `npm install --save-dev @prisma\/prisma7@7` and run `prisma7 [^`]+`\.$/;
const NPX = /\bnpx\b/;

function makeProcess(argv: readonly string[], stdoutIsTty: boolean) {
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
    cwd: () => "/tmp/v7-redirects-test-cwd",
    stdoutText: "",
    stderrText: "",
    stdout: {
      isTTY: stdoutIsTty,
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

async function run(argv: readonly string[], stdoutIsTty = false) {
  const proc = makeProcess(argv, stdoutIsTty);
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

function step(label: string, command: string): NextAction {
  return { kind: "run-command", label, command };
}

function help(path: string): NextAction {
  return step("Read its help", `prisma ${path} --help`);
}

const DOCS: NextAction = {
  kind: "open-url",
  label: "Read the docs",
  url: CLI_DOCS_URL,
};

const ORM_INIT: readonly NextAction[] = [
  step("Use the replacement", "prisma orm init"),
  help("orm init"),
];

const PATHS: Readonly<Record<string, readonly NextAction[]>> = {
  bootstrap: [
    step("Step 1", "prisma project create <name>"),
    step("Step 2", "prisma postgres create <name>"),
    help("project create"),
  ],
  version: [step("Use the replacement", "prisma --version")],
  debug: [DOCS],
  mcp: [DOCS],
  complete: [DOCS],
  "platform status": [DOCS],
  "postgres link": [
    step("Step 1", "prisma project link"),
    step("Step 2", "prisma postgres connection create <database>"),
    help("postgres connection create"),
  ],
};

const INIT_FLAGS: Readonly<Record<string, readonly NextAction[]>> = {
  db: [
    step("Use the replacement", "prisma postgres create <name>"),
    help("postgres create"),
  ],
  "datasource-provider": ORM_INIT,
  "generator-provider": ORM_INIT,
  "preview-feature": ORM_INIT,
  output: ORM_INIT,
  url: ORM_INIT,
  "with-model": ORM_INIT,
  "no-skills": [
    step("Use the replacement", "prisma init --skills=none"),
    help("init"),
  ],
};

function install(invocation: string): string {
  return ` To keep using Prisma 7, install its CLI with \`npm install --save-dev @prisma/prisma7@7\` and run \`prisma7 ${invocation}\`.`;
}

const PATH_WHY: Readonly<Record<string, string>> = {
  bootstrap:
    "Setting up a new app takes two commands: `project create` creates a Project, the container for one app's databases and services, and links this directory to it; `postgres create` then adds a Prisma Postgres database to that Project and prints its connection URL once, without writing it to a .env file. Neither sets up a database schema or the code your app queries the database with; `orm init` does that." +
    install("bootstrap"),
  version:
    "`--version` prints only this CLI's version number. It does not report Node.js, operating system or engine details." +
    install("version"),
  debug:
    "No command prints debugging information about this CLI and its environment." +
    install("debug"),
  mcp:
    "No command starts an MCP (Model Context Protocol) server for AI tools." +
    install("mcp"),
  complete:
    "This CLI has no shell completion: no command prints or installs a completion script for your shell." +
    install("complete <shell>"),
  "platform status":
    "No command reports whether Prisma Data Platform services are up." +
    install("platform status"),
  "postgres link":
    "Linking and connecting are two commands: `project link` points this directory at an existing Project, so commands run here act on it; `postgres connection create` creates a connection URL for one of its databases. The URL prints once, in that command's output; nothing writes it to a .env file." +
    install("postgres link"),
};

const INIT_SCHEMA_WHY =
  "`init` prepares this repository for Prisma: it writes prisma.config.ts, adds prisma as a dev dependency and installs the AI-agent skills. It sets up no database schema or client; `orm init` does that.";

const INIT_FLAG_WHY: Readonly<Record<string, string>> = {
  db:
    "`init` creates no database. `postgres create` creates a Prisma Postgres database in the Project this directory is linked to." +
    install("init --db"),
  "datasource-provider":
    INIT_SCHEMA_WHY + install("init --datasource-provider <provider>"),
  "generator-provider":
    INIT_SCHEMA_WHY + install("init --generator-provider <provider>"),
  "preview-feature":
    INIT_SCHEMA_WHY + install("init --preview-feature <feature>"),
  output: INIT_SCHEMA_WHY + install("init --output <path>"),
  url: INIT_SCHEMA_WHY + install("init --url <url>"),
  "with-model": INIT_SCHEMA_WHY + install("init --with-model"),
  "no-skills":
    "`--skills=none` skips installing the AI-agent skills and records in prisma.config.ts that none are wanted, so later installs do not add them." +
    install("init --no-skills"),
};

function humanLine(action: NextAction): string {
  return `→ ${action.label}: ${action.command ?? action.url}`;
}

describe("v7 command paths the shell owns", () => {
  it("declares exactly the paths this test covers", () => {
    expect(
      v7CommandFamily.redirects
        .filter((redirect) => redirect.flag === undefined)
        .map((redirect) => redirect.from)
        .sort(),
    ).toEqual(Object.keys(PATHS).sort());
  });

  it.each(
    Object.entries(PATHS),
  )("`%s` settles as CLI.V7_COMMAND in --json output", async (path, nextActions) => {
    const result = await run([...path.split(" "), "--json"]);

    expect(result.exitCode).toBe(2);
    const envelope = failedEnvelope(result.stdout);
    expect(envelope.commandId).toBe(path.replaceAll(" ", "."));
    expect(envelope.error.code).toBe("CLI.V7_COMMAND");
    expect(envelope.error.summary).toBe(
      `\`prisma ${path}\` is a Prisma 7 command and is not available in Prisma 8`,
    );
    expect(envelope.error.why).toBe(PATH_WHY[path]);
    expect(envelope.nextActions).toEqual(nextActions);
    expect(envelope.error.nextActions).toEqual(nextActions);
  });

  it.each(
    Object.entries(PATHS),
  )("`%s` settles as CLI.V7_COMMAND in human output", async (path, nextActions) => {
    const result = await run(path.split(" "), true);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    const lines = result.stderr.trimEnd().split("\n");
    expect(lines[0]).toBe(
      `✘ [CLI.V7_COMMAND] \`prisma ${path}\` is a Prisma 7 command and is not available in Prisma 8`,
    );
    expect(lines[1]).toMatch(WHY_LINE);
    expect(lines.slice(-nextActions.length)).toEqual(
      nextActions.map(humanLine),
    );
  });
});

describe("v7 flags on the shell's init", () => {
  it("declares exactly the flags this test covers", () => {
    expect(
      v7CommandFamily.redirects
        .filter((redirect) => redirect.flag !== undefined)
        .map((redirect) => {
          expect(redirect.from).toBe("init");
          return redirect.flag?.replace(
            UPPERCASE_LETTER,
            (letter) => `-${letter.toLowerCase()}`,
          );
        })
        .sort(),
    ).toEqual(Object.keys(INIT_FLAGS).sort());
  });

  it.each(
    Object.entries(INIT_FLAGS),
  )("`init --%s` settles as CLI.V7_FLAG in --json output", async (flag, nextActions) => {
    const result = await run(["init", `--${flag}`, "--json"]);

    expect(result.exitCode).toBe(2);
    const envelope = failedEnvelope(result.stdout);
    expect(envelope.commandId).toBe("init");
    expect(envelope.error.code).toBe("CLI.V7_FLAG");
    expect(envelope.error.summary).toBe(
      `\`--${flag}\` on \`prisma init\` is a Prisma 7 flag and is not available in Prisma 8`,
    );
    expect(envelope.error.why).toBe(INIT_FLAG_WHY[flag]);
    expect(envelope.nextActions).toEqual(nextActions);
  });

  it.each(
    Object.entries(INIT_FLAGS),
  )("`init --%s` settles as CLI.V7_FLAG in human output", async (flag, nextActions) => {
    const result = await run(["init", `--${flag}`], true);

    expect(result.exitCode).toBe(2);
    const lines = result.stderr.trimEnd().split("\n");
    expect(lines[0]).toBe(
      `✘ [CLI.V7_FLAG] \`--${flag}\` on \`prisma init\` is a Prisma 7 flag and is not available in Prisma 8`,
    );
    expect(lines.slice(-nextActions.length)).toEqual(
      nextActions.map(humanLine),
    );
  });

  it("a value after the retired flag does not stop it matching", async () => {
    const result = await run([
      "init",
      "--datasource-provider",
      "mysql",
      "--json",
    ]);

    expect(failedEnvelope(result.stdout).error.code).toBe("CLI.V7_FLAG");
  });
});

function suggestedPath(invocation: string): string {
  return invocation
    .replaceAll("{bin}", "")
    .split(WHITESPACE)
    .filter(
      (token) =>
        token !== "" && !token.startsWith("-") && !token.startsWith("<"),
    )
    .join(" ");
}

describe("every suggestion names a mounted command", () => {
  const suggestions = v7CommandFamily.redirects.flatMap((redirect) => [
    ...redirect.replacement,
    ...(redirect.help === undefined ? [] : [redirect.help]),
  ]);

  it.each(suggestions)("`%s` is mounted", (suggestion) => {
    if (suggestion === "{bin} --version") {
      return;
    }
    expect(Object.keys(mountedCommands)).toContain(suggestedPath(suggestion));
  });

  it("no entry mentions Prisma 7 outside its summary and install sentence", () => {
    for (const redirect of v7CommandFamily.redirects) {
      const stripped = redirect.reason?.replace(INSTALL_SENTENCE, "");
      expect(stripped).not.toMatch(PRISMA_7);
      expect(stripped).not.toMatch(PRISMA_7_PACKAGE);
      expect(redirect.reason).not.toMatch(NPX);
      for (const suggestion of redirect.replacement) {
        expect(suggestion).not.toMatch(PRISMA_7_PACKAGE);
      }
    }
  });
});
