/**
 * A path that is both a command and a group: `dev` runs with an entry,
 * and `dev url` and `dev stop` are its children. A child's name wins
 * over a positional spelled the same.
 */
import {
  defineCommand,
  defineCommandFamily,
  flag,
  type MountedTree,
  positional,
  type RedirectSpec,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli, type TestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

function presenting(ran: string, data: Record<string, unknown>) {
  return { ran, ...data };
}

const dev = defineCommand({
  help: {
    summary: "Run the app locally",
    description: "Starts the entry module and watches it for changes.",
    examples: ["dev module.ts"],
  },
  args: {
    flags: { port: flag.number({ brief: "Port to listen on" }) },
    positionals: {
      entry: positional.optionalString({
        brief: "The module to run",
        placeholder: "entry",
      }),
    },
  },
  statements: { delete: { arity: 1, brief: "Delete a resource: --delete X" } },
  handler: async (args, ctx) => {
    const data = presenting("dev", {
      entry: args.positionals.entry,
      port: args.flags.port,
      deleted: ctx.statements.take("delete").map((answer) => answer.text),
    });
    return ok(
      ctx.present(
        { data },
        {
          human: () => [],
          stdout: () => [],
          json: () => data,
          next: () => [],
        },
      ),
    );
  },
});

const devUrl = defineCommand({
  help: { summary: "Print the local URL of a running service" },
  args: {
    positionals: {
      service: positional.optionalString({
        brief: "The service to print",
        placeholder: "service",
      }),
    },
  },
  handler: async (args, ctx) => {
    const data = presenting("dev url", { service: args.positionals.service });
    return ok(
      ctx.present(
        { data },
        {
          human: () => [],
          stdout: () => [],
          json: () => data,
          next: () => [],
        },
      ),
    );
  },
});

const devStop = defineCommand({
  help: { summary: "Stop the running app" },
  handler: async (_args, ctx) => {
    const data = presenting("dev stop", {});
    return ok(
      ctx.present(
        { data },
        {
          human: () => [],
          stdout: () => [],
          json: () => data,
          next: () => [],
        },
      ),
    );
  },
});

const DEV_GROUP = {
  dev: { brief: "Run the app locally. Start it, print URLs, stop it" },
};

function devCli(
  commands: MountedTree = {
    dev,
    "dev url": devUrl,
    "dev stop": devStop,
  },
  redirects: readonly RedirectSpec[] = [],
): TestCli {
  return createTestCli({
    commandFamilies: [defineCommandFamily({ commands, redirects })],
    commands,
    groups: DEV_GROUP,
  });
}

function lastEnvelope(result: Awaited<ReturnType<TestCli["run"]>>) {
  const last = result.json[result.json.length - 1];
  if (last.kind !== "result") {
    throw new Error("expected a result frame");
  }
  return last.envelope;
}

describe("routing", () => {
  test("the path's own command runs with a positional", async () => {
    const result = await devCli().run(["dev", "module.ts", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      ran: "dev",
      entry: "module.ts",
      port: undefined,
      deleted: [],
    });
    expect(lastEnvelope(result).commandId).toBe("dev");
  });

  test("the path's own command runs with no arguments instead of printing help", async () => {
    const result = await devCli().run(["dev"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ ran: "dev" });
  });

  test("the path's own command runs with only flags", async () => {
    const result = await devCli().run(["dev", "--port", "3000", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ ran: "dev", port: 3000 });
  });

  test("a child runs", async () => {
    const result = await devCli().run(["dev", "url", "gateway", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      ran: "dev url",
      service: "gateway",
    });
    expect(lastEnvelope(result).commandId).toBe("dev.url");
  });

  test("a child's name wins over a positional spelled the same", async () => {
    const result = await devCli().run(["dev", "url", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      ran: "dev url",
      service: undefined,
    });
  });

  test("routing does not depend on the order the paths were mounted in", async () => {
    const result = await devCli({
      "dev url": devUrl,
      "dev stop": devStop,
      dev,
    }).run(["dev", "module.ts", "--json"]);

    expect(result.presented?.data).toMatchObject({
      ran: "dev",
      entry: "module.ts",
    });
  });

  test("the path's own command takes its statement flags", async () => {
    const result = await devCli().run([
      "dev",
      "module.ts",
      "--delete",
      "Legacy",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ deleted: ["Legacy"] });
  });

  test("an unknown flag on the path's own command is a usage error for that command", async () => {
    const result = await devCli().run(["dev", "--frobnicate", "--json"]);

    expect(result.exitCode).toBe(2);
    const envelope = lastEnvelope(result);
    expect(envelope.commandId).toBe("dev");
    expect(!envelope.ok && envelope.error.code).toBe("CLI.INVALID_ARGUMENTS");
  });

  test("a retired flag on the path's own command names its replacement", async () => {
    const result = await devCli(undefined, [
      { from: "dev", flag: "listen", replacement: "dev --port 3000" },
    ]).run(["dev", "--listen", "3000", "--json"]);

    expect(result.exitCode).toBe(2);
    const envelope = lastEnvelope(result);
    expect(!envelope.ok && envelope.error.code).toBe("CLI.COMMAND_MOVED");
  });
});

describe("help", () => {
  test("--help on the path shows its command's usage and lists the children", async () => {
    const result = await devCli().run(["dev", "--help", "--no-color"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "prisma-test dev → Run the app locally\n\n│  Usage\n│    $ prisma-test dev [options] [entry]\n│\n│  Starts the entry module and watches it for changes.\n│\n│  Commands\n│  url [service]  Print the local URL of a running service\n│  stop           Stop the running app\n│\n│  Arguments\n│  entry  The module to run (optional)\n│\n│  Options\n│      --port <value>       Port to listen on\n│      --delete <value>...  Delete a resource: --delete X\n│\n│  Global options also apply: --format, --json, --log-level, --verbose,\n│  --quiet, --yes, --confirm, --interactive, --color, --config. Run\n│  'prisma-test --help' for details.\n│\n│  Examples\n│    $ prisma-test dev module.ts\n\n",
    );
  });

  test("--help after a positional shows the path's own help", async () => {
    const withPositional = await devCli().run([
      "dev",
      "module.ts",
      "--help",
      "--no-color",
    ]);
    const bare = await devCli().run(["dev", "--help", "--no-color"]);

    expect(withPositional.stdout).toBe(bare.stdout);
  });

  test("--help on a child shows the child's help", async () => {
    const result = await devCli().run(["dev", "url", "--help", "--no-color"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "prisma-test dev url → Print the local URL of a running service",
    );
    expect(result.stdout).toContain("$ prisma-test dev url [options] [service]");
  });

  test("Markdown help lists the children under the usage", async () => {
    const result = await devCli().run(["dev", "--help", "--format", "markdown"]);

    expect(result.stdout).toContain(
      "## Usage\n\n```bash\nprisma-test dev [options] [entry]\n```",
    );
    expect(result.stdout).toContain(
      "## Commands\n\n| Command | Description |\n| --- | --- |\n| `url [service]` | Print the local URL of a running service |\n| `stop` | Stop the running app |",
    );
  });

  test("the parent card lists the path once, with its group brief", async () => {
    const result = await devCli().run(["--help", "--no-color"]);

    expect(result.stdout).toContain(
      "│  dev  Run the app locally. Start it, print URLs, stop it\n",
    );
    expect(result.stdout.match(/│ {2}dev /g)).toHaveLength(1);
  });
});

describe("construction", () => {
  test("the path still needs a group declaration", () => {
    expect(() =>
      createTestCli({ commands: { dev, "dev url": devUrl } }),
    ).toThrow("unknown group 'dev'");
  });

  test("the path's own command is still validated", () => {
    const offender = defineCommand({
      help: { summary: "Offender" },
      args: { flags: { json: flag.boolean({ brief: "mine" }) } },
      handler: null as never,
    });

    expect(() =>
      createTestCli({
        commands: { dev: offender, "dev url": devUrl },
        groups: DEV_GROUP,
      }),
    ).toThrow("command 'dev' declares reserved flag 'json'");
  });

  test("a verb redirect onto the path collides with its command", () => {
    expect(() =>
      devCli(undefined, [{ from: "dev", replacement: "run" }]),
    ).toThrow("redirect 'dev' collides with a mounted command");
  });
});
