/**
 * D3: the installsPackages capability — ctx.packages, the structured
 * failure, redaction, and the events both operations frame. Every run
 * goes through createTestCli with a scripted runner, so no real package
 * manager is involved.
 */
import {
  defineCommand,
  type EngineEvent,
  type PackageManagerRunner,
  type PackageManagerRunResult,
  type PackageOperations,
} from "@prisma/cli-engine";
import {
  type CliStructuredError,
  notOk,
  ok,
  type Result,
} from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";
import { redactSecrets } from "../src/execution/redaction";

describe("redactSecrets", () => {
  test("a URL's userinfo goes and the rest of the URL stays", () => {
    expect(
      redactSecrets("npm ERR! 401 https://bot:s3cret@registry.acme.dev/prisma"),
    ).toBe("npm ERR! 401 https://…@registry.acme.dev/prisma");
  });

  test("a bare username is userinfo too", () => {
    expect(redactSecrets("git+ssh://deploy@github.com/acme/app.git")).toBe(
      "git+ssh://…@github.com/acme/app.git",
    );
  });

  test("assignments whose name says secret lose their value", () => {
    expect(
      redactSecrets(
        "NPM_TOKEN=abc123 PRISMA_API_KEY=xyz ci_secret=q MY_PASSWORD=hunter2",
      ),
    ).toBe("NPM_TOKEN=… PRISMA_API_KEY=… ci_secret=… MY_PASSWORD=…");
  });

  test("a quoted value goes whole, so nothing after the space survives", () => {
    expect(redactSecrets('AUTH_TOKEN="one two" --frozen-lockfile')).toBe(
      "AUTH_TOKEN=… --frozen-lockfile",
    );
  });

  test("an assignment that names nothing secret is left alone", () => {
    expect(redactSecrets("npm_config_registry=https://registry.acme.dev")).toBe(
      "npm_config_registry=https://registry.acme.dev",
    );
  });

  test("the error text a caller's retry predicate matches survives", () => {
    const stderr = [
      'ERR_PNPM_WORKSPACE_PKG_NOT_FOUND  In app: "prisma@workspace:*" is in the dependencies but no package named prisma is present',
      "ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @prisma/client@catalog:default",
    ].join("\n");

    expect(redactSecrets(stderr)).toBe(stderr);
  });
});

interface SeenRun {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

function recorder(
  result: PackageManagerRunResult = { exitCode: 0, stderr: "" },
): { readonly runs: SeenRun[]; readonly runner: PackageManagerRunner } {
  const runs: SeenRun[] = [];
  return {
    runs,
    runner: async ({ file, args, cwd }) => {
      runs.push({ file, args: [...args], cwd });
      return result;
    },
  };
}

type OperationResult = Result<{ readonly command: string }, CliStructuredError>;

/** A command that performs one operation and reports its outcome as the
 *  command's own: ok presents the command line it ran, notOk hands the
 *  engine the structured failure verbatim. */
function installer(
  operation: (packages: PackageOperations) => Promise<OperationResult>,
) {
  return defineCommand({
    help: { summary: "Installs packages" },
    installsPackages: true,
    handler: async (_args, ctx) => {
      const outcome = await operation(ctx.packages);
      if (!outcome.ok) {
        return notOk(outcome.failure);
      }
      return ok(
        ctx.present(
          { data: outcome.value },
          { human: () => [], json: () => outcome.value },
        ),
      );
    },
  });
}

describe("the installsPackages capability", () => {
  test("declared: ctx.packages is on the context", async () => {
    let present: boolean | undefined;
    const toy = defineCommand({
      help: { summary: "Installs packages" },
      installsPackages: true,
      handler: async (_args, ctx) => {
        present = "packages" in ctx;
        return ok(ctx.present({ data: null }, { human: () => [] }));
      },
    });
    const cli = createTestCli({ commands: { toy } });

    const { exitCode } = await cli.run(["toy"]);

    expect(exitCode).toBe(0);
    expect(present).toBe(true);
  });

  test("undeclared: packages is absent from the context", async () => {
    let present: boolean | undefined;
    const toy = defineCommand({
      help: { summary: "Installs nothing" },
      handler: async (_args, ctx) => {
        present = "packages" in ctx;
        return ok(ctx.present({ data: null }, { human: () => [] }));
      },
    });
    const cli = createTestCli({ commands: { toy } });

    const { exitCode } = await cli.run(["toy"]);

    expect(exitCode).toBe(0);
    expect(present).toBe(false);
  });
});

describe("ctx.packages.install", () => {
  test("runs the manager's own add in the run's cwd", async () => {
    const { runs, runner } = recorder();
    const cli = createTestCli({
      commands: {
        toy: installer((packages) =>
          packages.install({ packages: ["prisma@latest"], dev: true }),
        ),
      },
      packageManager: "pnpm",
      packageManagerRunner: runner,
    });

    const { exitCode, presented } = await cli.run(["toy"], { cwd: "/project" });

    expect(exitCode).toBe(0);
    expect(runs).toEqual([
      { file: "pnpm", args: ["add", "-D", "prisma@latest"], cwd: "/project" },
    ]);
    expect(presented?.data).toEqual({ command: "pnpm add -D prisma@latest" });
  });

  test("the manager override is what the caller's retry needs", async () => {
    const { runs, runner } = recorder();
    const cli = createTestCli({
      commands: {
        toy: installer((packages) =>
          packages.install({ packages: ["prisma"], manager: "npm" }),
        ),
      },
      packageManager: "pnpm",
      packageManagerRunner: runner,
    });

    await cli.run(["toy"], { cwd: "/project" });

    expect(runs).toEqual([
      { file: "npm", args: ["add", "prisma"], cwd: "/project" },
    ]);
  });

  test("a cwd of its own overrides the run's", async () => {
    const { runs, runner } = recorder();
    const cli = createTestCli({
      commands: {
        toy: installer((packages) =>
          packages.install({ packages: ["prisma"], cwd: "/elsewhere" }),
        ),
      },
      packageManager: "npm",
      packageManagerRunner: runner,
    });

    await cli.run(["toy"], { cwd: "/project" });

    expect(runs).toEqual([
      { file: "npm", args: ["add", "prisma"], cwd: "/elsewhere" },
    ]);
  });
});

describe("ctx.packages.run", () => {
  test("runs a package's bin once, without adding a dependency", async () => {
    const { runs, runner } = recorder();
    const cli = createTestCli({
      commands: {
        toy: installer((packages) =>
          packages.run({ package: "skills@latest", args: ["add", "-y"] }),
        ),
      },
      packageManager: "pnpm",
      packageManagerRunner: runner,
    });

    const { exitCode, presented } = await cli.run(["toy"], { cwd: "/project" });

    expect(exitCode).toBe(0);
    expect(runs).toEqual([
      {
        file: "pnpm",
        args: ["dlx", "skills@latest", "add", "-y"],
        cwd: "/project",
      },
    ]);
    expect(presented?.data).toEqual({
      command: "pnpm dlx skills@latest add -y",
    });
  });
});

describe("the events an operation frames", () => {
  test("one step pair around it, the manager's own output inside", async () => {
    const runner: PackageManagerRunner = async ({ onOutput }) => {
      onOutput("data", "Packages: +2\n");
      onOutput("diagnostic", "WARN deprecated sub");
      onOutput("diagnostic", "dependency\n");
      return { exitCode: 0, stderr: "" };
    };
    const cli = createTestCli({
      commands: {
        toy: installer((packages) =>
          packages.install({ packages: ["prisma"] }),
        ),
      },
      packageManager: "pnpm",
      packageManagerRunner: runner,
    });

    const { events } = await cli.run(["toy"]);

    expect(events).toEqual<EngineEvent[]>([
      { kind: "step-started", step: "pnpm add prisma" },
      {
        kind: "output",
        source: "pnpm",
        channel: "data",
        line: "Packages: +2",
      },
      {
        kind: "output",
        source: "pnpm",
        channel: "diagnostic",
        line: "WARN deprecated subdependency",
      },
      { kind: "step-finished", step: "pnpm add prisma", outcome: "ok" },
    ]);
  });

  test("a trailing chunk with no newline still reaches the user", async () => {
    const runner: PackageManagerRunner = async ({ onOutput }) => {
      onOutput("diagnostic", "resolving…");
      return { exitCode: 0, stderr: "" };
    };
    const cli = createTestCli({
      commands: {
        toy: installer((packages) =>
          packages.install({ packages: ["prisma"] }),
        ),
      },
      packageManager: "npm",
      packageManagerRunner: runner,
    });

    const { events } = await cli.run(["toy"]);

    expect(events).toContainEqual({
      kind: "output",
      source: "npm",
      channel: "diagnostic",
      line: "resolving…",
    });
  });

  test("a failed manager finishes the step as failed", async () => {
    const { runner } = recorder({ exitCode: 1, stderr: "boom" });
    const cli = createTestCli({
      commands: {
        toy: installer((packages) =>
          packages.install({ packages: ["prisma"] }),
        ),
      },
      packageManager: "npm",
      packageManagerRunner: runner,
    });

    const { events } = await cli.run(["toy"]);

    expect(events).toContainEqual({
      kind: "step-finished",
      step: "npm add prisma",
      outcome: "failed",
    });
  });
});

describe("CLI.PACKAGE_MANAGER_FAILED", () => {
  test("a manager that failed is a value carrying everything the caller needs", async () => {
    const { runner } = recorder({
      exitCode: 1,
      stderr:
        "ERR_PNPM_NO_MATCHING_VERSION  registry https://bot:s3cret@registry.acme.dev",
    });
    const cli = createTestCli({
      commands: {
        toy: installer((packages) =>
          packages.install({ packages: ["prisma@9"] }),
        ),
      },
      packageManager: "pnpm",
      packageManagerRunner: runner,
    });

    const { exitCode, json } = await cli.run(["toy", "--json"]);

    expect(exitCode).toBe(2);
    expect(json.find((frame) => frame.kind === "result")).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: "CLI.PACKAGE_MANAGER_FAILED",
          summary: "Installing packages with pnpm failed.",
          why: "pnpm exited with code 1.",
          meta: {
            form: "install",
            manager: "pnpm",
            command: "pnpm add prisma@9",
            exitCode: 1,
            stderrTail:
              "ERR_PNPM_NO_MATCHING_VERSION  registry https://…@registry.acme.dev",
          },
          nextActions: [
            {
              kind: "run-command",
              label: "Run the install yourself",
              command: "pnpm add prisma@9",
            },
          ],
        },
      },
    });
  });

  test("the run form names the package it could not run", async () => {
    const { runner } = recorder({ exitCode: 127, stderr: "not found" });
    const cli = createTestCli({
      commands: {
        toy: installer((packages) =>
          packages.run({ package: "skills", args: [] }),
        ),
      },
      packageManager: "bun",
      packageManagerRunner: runner,
    });

    const { json } = await cli.run(["toy", "--json"]);

    expect(json.find((frame) => frame.kind === "result")).toMatchObject({
      envelope: {
        error: {
          summary: "Running skills with bun failed.",
          meta: { form: "run", manager: "bun", exitCode: 127 },
          nextActions: [
            {
              kind: "run-command",
              label: "Run the command yourself",
              command: "bunx skills",
            },
          ],
        },
      },
    });
  });

  test("what is shown is redacted; what the user is told to run is not", async () => {
    const secret = "https://bot:s3cret@registry.acme.dev/prisma.tgz";
    const { runner } = recorder({ exitCode: 1, stderr: "" });
    const cli = createTestCli({
      commands: {
        toy: installer((packages) => packages.install({ packages: [secret] })),
      },
      packageManager: "npm",
      packageManagerRunner: runner,
    });

    const { events, json } = await cli.run(["toy", "--json"]);
    const envelope = json.find((frame) => frame.kind === "result");

    expect(events).toContainEqual({
      kind: "step-started",
      step: "npm add https://…@registry.acme.dev/prisma.tgz",
    });
    expect(envelope).toMatchObject({
      envelope: {
        error: {
          meta: { command: "npm add https://…@registry.acme.dev/prisma.tgz" },
          nextActions: [{ command: `npm add ${secret}` }],
        },
      },
    });
  });

  test("a host with no runner resolves the failure and steps nothing", async () => {
    const cli = createTestCli({
      commands: {
        toy: installer((packages) =>
          packages.install({ packages: ["prisma"] }),
        ),
      },
      packageManager: "npm",
    });

    const { exitCode, events, json } = await cli.run(["toy", "--json"]);

    expect(exitCode).toBe(2);
    expect(events).toEqual([]);
    expect(json.find((frame) => frame.kind === "result")).toMatchObject({
      envelope: {
        error: {
          code: "CLI.PACKAGE_MANAGER_FAILED",
          why: "This host wires no package-manager runner, so nothing was run.",
          meta: {
            form: "install",
            manager: "npm",
            command: "npm add prisma",
            exitCode: 1,
            stderrTail: "",
            reason: "runner-unavailable",
          },
        },
      },
    });
  });
});

describe("the two ways an operation does not resolve notOk", () => {
  test("a second operation while one is running is a caller bug, exit 1", async () => {
    const { runner } = recorder();
    const toy = defineCommand({
      help: { summary: "Installs twice at once" },
      installsPackages: true,
      handler: async (_args, ctx) => {
        const settled = await Promise.allSettled([
          ctx.packages.install({ packages: ["prisma"] }),
          ctx.packages.install({ packages: ["@prisma/client"] }),
        ]);
        const rejected = settled.find(
          (outcome) => outcome.status === "rejected",
        );
        if (rejected !== undefined) {
          throw rejected.reason;
        }
        return ok(ctx.present({ data: null }, { human: () => [] }));
      },
    });
    const cli = createTestCli({
      commands: { toy },
      packageManager: "npm",
      packageManagerRunner: runner,
    });

    const { exitCode, json } = await cli.run(["toy", "--json"]);

    expect(exitCode).toBe(1);
    expect(json.find((frame) => frame.kind === "result")).toMatchObject({
      envelope: {
        error: {
          code: "CLI.INTERNAL_ERROR",
          summary:
            "@prisma/cli-engine: ctx.packages runs one operation at a time, so two package managers can never write one project at once",
        },
      },
    });
  });

  test("a cancelled operation settles the way Ctrl-C settles everywhere else", async () => {
    const controller = new AbortController();
    const runner: PackageManagerRunner = async () => {
      controller.abort();
      return { exitCode: 1, stderr: "killed" };
    };
    const cli = createTestCli({
      commands: {
        toy: installer((packages) =>
          packages.install({ packages: ["prisma"] }),
        ),
      },
      packageManager: "npm",
      packageManagerRunner: runner,
    });

    const { exitCode, json } = await cli.run(["toy", "--json"], {
      abort: controller.signal,
    });

    expect(exitCode).toBe(130);
    expect(json.find((frame) => frame.kind === "result")).toMatchObject({
      envelope: { ok: false, error: { code: "CLI.ABORTED" } },
    });
  });

  test("the child sees the run's own signal", async () => {
    let sameSignal: boolean | undefined;
    let captured: AbortSignal | undefined;
    const runner: PackageManagerRunner = async ({ signal }) => {
      captured = signal;
      return { exitCode: 0, stderr: "" };
    };
    const toy = defineCommand({
      help: { summary: "Installs packages" },
      installsPackages: true,
      handler: async (_args, ctx) => {
        await ctx.packages.install({ packages: ["prisma"] });
        sameSignal = captured === ctx.signal;
        return ok(ctx.present({ data: null }, { human: () => [] }));
      },
    });
    const cli = createTestCli({
      commands: { toy },
      packageManager: "npm",
      packageManagerRunner: runner,
    });

    await cli.run(["toy"]);

    expect(sameSignal).toBe(true);
  });
});
