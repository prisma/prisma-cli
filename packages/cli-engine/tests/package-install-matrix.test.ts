/**
 * D4: the proof. One sample command declaring `installsPackages` —
 * shaped like the ORM init this capability was built for — driven
 * through createTestCli across its whole matrix: success in both forms,
 * a manager that failed, the pnpm-to-npm fallback, cancellation, a host
 * with no runner, and two operations at once. Every run is offline with
 * no real package manager, and both surfaces are asserted: the human
 * transcript and the --json stream.
 */
import {
  type Block,
  type CompletedEnvelope,
  defineCommand,
  type ErroredEnvelope,
  type PackageManagerId,
  type PackageManagerRunner,
  type PackageManagerRunResult,
  type StreamEvent,
} from "@prisma/cli-engine";
import {
  type CliStructuredError,
  type Diagnostic,
  notOk,
  ok,
  type Result,
} from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const EPOCH = () => new Date(0);
const T0 = "1970-01-01T00:00:00.000Z";

const RUNTIME_PACKAGES = ["prisma@latest", "@prisma/client@latest"];
const TOOLING_PACKAGES = ["typescript@latest"];
const SKILLS_PACKAGE = "@prisma/agent-skills";
const PRIVATE_TARBALL = "https://ci:s3cret@registry.acme.dev/client.tgz";
const REDACTED_TARBALL = "https://…@registry.acme.dev/client.tgz";

const PNPM_RESOLUTION_FAILURES: readonly RegExp[] = [
  /ERR_PNPM_WORKSPACE_PKG_NOT_FOUND/,
  /ERR_PNPM_NO_MATCHING_VERSION/,
  /No matching version found for .* in the catalog/i,
  /workspace:\S+ is not a valid (?:version|spec)/i,
  /catalog:\S* is not a valid (?:version|spec)/i,
];

/** isRecognisedPnpmResolutionError from the ORM's init.ts, which spec §5
 *  says moves to the ported handler unchanged. The engine never learns
 *  these strings. */
function isRecognisedPnpmResolutionError(stderr: string): boolean {
  return PNPM_RESOLUTION_FAILURES.some((pattern) => pattern.test(stderr));
}

function stderrTailOf(failure: CliStructuredError): string {
  const tail = failure.meta?.stderrTail;
  return typeof tail === "string" ? tail : "";
}

function pnpmCouldNotResolve(failure: CliStructuredError): boolean {
  return (
    failure.meta?.manager === "pnpm" &&
    isRecognisedPnpmResolutionError(stderrTailOf(failure))
  );
}

function fallbackWarning(stderrTail: string): string {
  return `pnpm could not resolve a dependency, so npm ran instead: ${stderrTail.split("\n")[0]}`;
}

function warnBlock(text: string): Block {
  return { kind: "summary", status: "warn", text };
}

/**
 * The sample command: scaffolding that installs its dependencies, its
 * tooling, and the agent skills, retrying with npm when pnpm reports a
 * workspace or catalog specifier it cannot resolve. Everything after a
 * fallback runs on npm too, which is what the ORM's init does.
 */
const init = defineCommand({
  help: { summary: "Scaffold a project and install what it needs" },
  installsPackages: true,
  handler: async (_args, ctx) => {
    const warnings: string[] = [];
    let manager: PackageManagerId | undefined;

    const install = async (request: {
      readonly packages: readonly string[];
      readonly dev?: boolean;
    }): Promise<Result<void, CliStructuredError>> => {
      const attempt = await ctx.packages.install({ ...request, manager });
      if (attempt.ok || !pnpmCouldNotResolve(attempt.failure)) {
        return attempt;
      }
      warnings.push(fallbackWarning(stderrTailOf(attempt.failure)));
      manager = "npm";
      return ctx.packages.install({ ...request, manager });
    };

    const dependencies = await install({ packages: RUNTIME_PACKAGES });
    if (!dependencies.ok) {
      return notOk(dependencies.failure);
    }

    const tooling = await install({ packages: TOOLING_PACKAGES, dev: true });
    if (!tooling.ok) {
      return notOk(tooling.failure);
    }

    const skills = await ctx.packages.run({
      package: SKILLS_PACKAGE,
      args: ["add", "prisma"],
      manager,
    });
    if (!skills.ok) {
      return notOk(skills.failure);
    }

    return ok(
      ctx.present(
        { data: { warnings } },
        {
          human: () => warnings.map(warnBlock),
          json: () => ({ warnings }),
        },
      ),
    );
  },
});

/**
 * The same two installs, fired without awaiting the first. Which one the
 * interlock refuses is its contract, not an accident of how the results
 * are read: the first call takes the claim and runs, and the second is
 * the caller bug.
 */
const race = defineCommand({
  help: { summary: "Installs both dependency sets at once" },
  installsPackages: true,
  handler: async (_args, ctx) => {
    const [dependencies, tooling] = await Promise.allSettled([
      ctx.packages.install({ packages: RUNTIME_PACKAGES }),
      ctx.packages.install({ packages: TOOLING_PACKAGES, dev: true }),
    ]);
    if (dependencies.status === "rejected") {
      throw new Error(
        `the interlock refused the first install: ${String(dependencies.reason)}`,
      );
    }
    if (tooling.status !== "rejected") {
      throw new Error("the interlock let the second install through");
    }
    throw tooling.reason;
  },
});

/**
 * The same install pointed at a private registry: the specifier the user
 * supplied carries the credential the manager needs to fetch it.
 */
const vendored = defineCommand({
  help: { summary: "Install a dependency from a private registry" },
  installsPackages: true,
  handler: async (_args, ctx) => {
    const installed = await ctx.packages.install({
      packages: [PRIVATE_TARBALL],
    });
    if (!installed.ok) {
      return notOk(installed.failure);
    }
    return ok(ctx.present({ data: null }, { human: () => [] }));
  },
});

interface SeamCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

const SUCCESS: PackageManagerRunResult = { exitCode: 0, stderr: "" };

/**
 * The stand-in for the shipped bin's spawner: records what the engine
 * composed, echoes the chatter a real manager writes on both channels,
 * and returns the scripted result for that call (later calls succeed).
 */
function fakeManager(...script: readonly PackageManagerRunResult[]): {
  readonly calls: SeamCall[];
  readonly runner: PackageManagerRunner;
} {
  const calls: SeamCall[] = [];
  return {
    calls,
    runner: async ({ file, args, cwd, onOutput }) => {
      calls.push({ file, args: [...args], cwd });
      onOutput("diagnostic", `${file}: resolving\n`);
      onOutput("data", `+ ${args.join(" ")}\n`);
      return script[calls.length - 1] ?? SUCCESS;
    },
  };
}

function commandLine(call: SeamCall): string {
  return [call.file, ...call.args].join(" ");
}

function cliWith(spec: {
  readonly manager?: PackageManagerId;
  readonly runner?: PackageManagerRunner;
}) {
  return createTestCli({
    commands: { init, race, vendored },
    packageManager: spec.manager ?? "pnpm",
    packageManagerRunner: spec.runner,
    now: EPOCH,
  });
}

function envelopeOf(
  frames: readonly StreamEvent[],
): CompletedEnvelope | ErroredEnvelope {
  const last = frames.at(-1);
  if (last === undefined || last.kind !== "result") {
    throw new Error("the run's json stream did not end in a result frame");
  }
  return last.envelope;
}

function errorOf(frames: readonly StreamEvent[]): Diagnostic {
  const envelope = envelopeOf(frames);
  if (envelope.ok) {
    throw new Error("the run completed instead of failing");
  }
  return envelope.error;
}

const PNPM_ADD_RUNTIME = "pnpm add prisma@latest @prisma/client@latest";
const NPM_ADD_RUNTIME = "npm add prisma@latest @prisma/client@latest";

/** The harness gives the run no TTY, which makes json the default
 *  format; the human transcript has to be asked for. */
const HUMAN = ["init", "--format", "human"];
const JSON_MODE = ["init", "--json"];
const RACE_HUMAN = ["race", "--format", "human"];
const RACE_JSON = ["race", "--json"];

describe("every operation succeeds", () => {
  test("human mode: a step pair per operation, the manager's output split by channel", async () => {
    const { calls, runner } = fakeManager();

    const result = await cliWith({ runner }).run(HUMAN, { cwd: "/project" });

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual<SeamCall[]>([
      {
        file: "pnpm",
        args: ["add", "prisma@latest", "@prisma/client@latest"],
        cwd: "/project",
      },
      {
        file: "pnpm",
        args: ["add", "-D", "typescript@latest"],
        cwd: "/project",
      },
      {
        file: "pnpm",
        args: ["dlx", "@prisma/agent-skills", "add", "prisma"],
        cwd: "/project",
      },
    ]);
    expect(result.presented?.data).toEqual({ warnings: [] });
    expect(result.stdout).toBe(
      "+ add prisma@latest @prisma/client@latest\n" +
        "+ add -D typescript@latest\n" +
        "+ dlx @prisma/agent-skills add prisma\n",
    );
    expect(result.stderr).toBe(
      `▸ ${PNPM_ADD_RUNTIME}\n` +
        "pnpm: resolving\n" +
        `✔ ${PNPM_ADD_RUNTIME}\n` +
        "▸ pnpm add -D typescript@latest\n" +
        "pnpm: resolving\n" +
        "✔ pnpm add -D typescript@latest\n" +
        "▸ pnpm dlx @prisma/agent-skills add prisma\n" +
        "pnpm: resolving\n" +
        "✔ pnpm dlx @prisma/agent-skills add prisma\n",
    );
  });

  test("json mode: the same operations framed, then one terminal envelope", async () => {
    const { runner } = fakeManager();

    const result = await cliWith({ runner }).run(JSON_MODE, {
      cwd: "/project",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.json.map((frame) => frame.kind)).toEqual([
      "step-started",
      "output",
      "output",
      "step-finished",
      "step-started",
      "output",
      "output",
      "step-finished",
      "step-started",
      "output",
      "output",
      "step-finished",
      "result",
    ]);
    expect(result.json.slice(0, 4)).toEqual<StreamEvent[]>([
      {
        kind: "step-started",
        step: PNPM_ADD_RUNTIME,
        commandId: "init",
        timestamp: T0,
      },
      {
        kind: "output",
        source: "pnpm",
        channel: "diagnostic",
        line: "pnpm: resolving",
        commandId: "init",
        timestamp: T0,
      },
      {
        kind: "output",
        source: "pnpm",
        channel: "data",
        line: "+ add prisma@latest @prisma/client@latest",
        commandId: "init",
        timestamp: T0,
      },
      {
        kind: "step-finished",
        step: PNPM_ADD_RUNTIME,
        outcome: "ok",
        commandId: "init",
        timestamp: T0,
      },
    ]);
    expect(envelopeOf(result.json)).toEqual<CompletedEnvelope>({
      ok: true,
      commandId: "init",
      result: { warnings: [] },
      exitCode: 0,
      diagnostics: [],
      nextActions: [],
    });
  });
});

const NPM_NOT_FOUND: PackageManagerRunResult = {
  exitCode: 1,
  stderr:
    "npm ERR! code E404\nnpm ERR! 404 GET https://ci:s3cret@registry.acme.dev/prisma",
};

const REDACTED_NPM_NOT_FOUND =
  "npm ERR! code E404\nnpm ERR! 404 GET https://…@registry.acme.dev/prisma";

describe("a manager that exited non-zero", () => {
  test("json mode: CLI.PACKAGE_MANAGER_FAILED carries the whole documented meta", async () => {
    const { calls, runner } = fakeManager(NPM_NOT_FOUND);

    const result = await cliWith({ manager: "npm", runner }).run(
      ["init", "--json"],
      { cwd: "/project" },
    );

    expect(result.exitCode).toBe(2);
    expect(calls).toHaveLength(1);
    expect(errorOf(result.json)).toEqual<Diagnostic>({
      code: "CLI.PACKAGE_MANAGER_FAILED",
      severity: "error",
      summary: "Installing packages with npm failed.",
      why: "npm exited with code 1.",
      nextActions: [
        {
          kind: "run-command",
          label: "Run the install yourself",
          command: NPM_ADD_RUNTIME,
        },
      ],
      meta: {
        form: "install",
        manager: "npm",
        command: NPM_ADD_RUNTIME,
        exitCode: 1,
        stderrTail: REDACTED_NPM_NOT_FOUND,
      },
    });
  });

  test("json mode: the credential in the specifier reaches the manager and no further, the remedy included", async () => {
    const { calls, runner } = fakeManager(NPM_NOT_FOUND);

    const result = await cliWith({ manager: "npm", runner }).run(
      ["vendored", "--json"],
      { cwd: "/project" },
    );

    expect(commandLine(calls[0])).toBe(`npm add ${PRIVATE_TARBALL}`);
    expect(errorOf(result.json).nextActions[0]?.command).toBe(
      `npm add ${REDACTED_TARBALL}`,
    );
    expect(errorOf(result.json).nextActions[0]?.command).not.toBe(
      commandLine(calls[0]),
    );
    expect(errorOf(result.json).meta?.command).toBe(
      errorOf(result.json).nextActions[0]?.command,
    );
  });

  test("human mode: the step fails, then the error and the command to run by hand", async () => {
    const { runner } = fakeManager(NPM_NOT_FOUND);

    const result = await cliWith({ manager: "npm", runner }).run(HUMAN, {
      cwd: "/project",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("+ add prisma@latest @prisma/client@latest\n");
    expect(result.stderr).toBe(
      `▸ ${NPM_ADD_RUNTIME}\n` +
        "npm: resolving\n" +
        `✘ ${NPM_ADD_RUNTIME}\n` +
        "✘ [CLI.PACKAGE_MANAGER_FAILED] Installing packages with npm failed.\n" +
        "  why: npm exited with code 1.\n" +
        `→ Run the install yourself: ${NPM_ADD_RUNTIME}\n`,
    );
  });
});

const PNPM_WORKSPACE_FAILURE: PackageManagerRunResult = {
  exitCode: 1,
  stderr:
    'ERR_PNPM_WORKSPACE_PKG_NOT_FOUND  "@prisma/client@workspace:*" is not on https://ci:s3cret@registry.acme.dev\n  This error happened while installing the dependencies of prisma-app.',
};

const FALLBACK_WARNING =
  'pnpm could not resolve a dependency, so npm ran instead: ERR_PNPM_WORKSPACE_PKG_NOT_FOUND  "@prisma/client@workspace:*" is not on https://…@registry.acme.dev';

describe("the ORM's pnpm-to-npm fallback", () => {
  test("the handler matches its own predicate off meta.stderrTail and retries as npm", async () => {
    const { calls, runner } = fakeManager(PNPM_WORKSPACE_FAILURE);

    const result = await cliWith({ runner }).run(HUMAN, { cwd: "/project" });

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual<SeamCall[]>([
      {
        file: "pnpm",
        args: ["add", "prisma@latest", "@prisma/client@latest"],
        cwd: "/project",
      },
      {
        file: "npm",
        args: ["add", "prisma@latest", "@prisma/client@latest"],
        cwd: "/project",
      },
      {
        file: "npm",
        args: ["add", "-D", "typescript@latest"],
        cwd: "/project",
      },
      {
        file: "npx",
        args: ["@prisma/agent-skills", "add", "prisma"],
        cwd: "/project",
      },
    ]);
    expect(result.presented?.data).toEqual({ warnings: [FALLBACK_WARNING] });
  });

  test("human mode: the failed pnpm step, the npm retry, and why it happened", async () => {
    const { runner } = fakeManager(PNPM_WORKSPACE_FAILURE);

    const result = await cliWith({ runner }).run(HUMAN, { cwd: "/project" });

    expect(result.stderr).toBe(
      `▸ ${PNPM_ADD_RUNTIME}\n` +
        "pnpm: resolving\n" +
        `✘ ${PNPM_ADD_RUNTIME}\n` +
        `▸ ${NPM_ADD_RUNTIME}\n` +
        "npm: resolving\n" +
        `✔ ${NPM_ADD_RUNTIME}\n` +
        "▸ npm add -D typescript@latest\n" +
        "npm: resolving\n" +
        "✔ npm add -D typescript@latest\n" +
        "▸ npx @prisma/agent-skills add prisma\n" +
        "npx: resolving\n" +
        "✔ npx @prisma/agent-skills add prisma\n" +
        `⚠ ${FALLBACK_WARNING}\n`,
    );
  });

  test("json mode: one failed step, three that succeeded, and a completed envelope", async () => {
    const { runner } = fakeManager(PNPM_WORKSPACE_FAILURE);

    const result = await cliWith({ runner }).run(JSON_MODE, {
      cwd: "/project",
    });

    expect(
      result.json
        .filter((frame) => frame.kind === "step-finished")
        .map((frame) => frame.outcome),
    ).toEqual(["failed", "ok", "ok", "ok"]);
    expect(envelopeOf(result.json)).toEqual<CompletedEnvelope>({
      ok: true,
      commandId: "init",
      result: { warnings: [FALLBACK_WARNING] },
      exitCode: 0,
      diagnostics: [],
      nextActions: [],
    });
  });

  test("a pnpm failure the predicate does not recognise is not retried", async () => {
    const { calls, runner } = fakeManager({
      ...PNPM_WORKSPACE_FAILURE,
      stderr: PNPM_WORKSPACE_FAILURE.stderr.replace(
        "ERR_PNPM_WORKSPACE_PKG_NOT_FOUND",
        "ERR_PNPM_SOMETHING_ELSE",
      ),
    });

    const result = await cliWith({ runner }).run(JSON_MODE, {
      cwd: "/project",
    });

    expect(result.exitCode).toBe(2);
    expect(calls).toHaveLength(1);
    expect(errorOf(result.json).meta?.manager).toBe("pnpm");
  });
});

const KILLED_CHILD: PackageManagerRunResult = { exitCode: 1, stderr: "" };

describe("cancellation", () => {
  test("an abort mid-operation settles 130, where the same exit code alone settles 2", async () => {
    const controller = new AbortController();
    const { runner: record } = fakeManager(KILLED_CHILD);
    const aborting: PackageManagerRunner = async (request) => {
      controller.abort();
      return record(request);
    };

    const cancelled = await cliWith({ runner: aborting }).run(HUMAN, {
      cwd: "/project",
      abort: controller.signal,
    });
    const failed = await cliWith({
      runner: fakeManager(KILLED_CHILD).runner,
    }).run(JSON_MODE, { cwd: "/project" });

    expect(cancelled.exitCode).toBe(130);
    expect(cancelled.stdout).toBe(
      "+ add prisma@latest @prisma/client@latest\n",
    );
    expect(cancelled.stderr).toBe(
      `▸ ${PNPM_ADD_RUNTIME}\n` +
        "pnpm: resolving\n" +
        `✘ ${PNPM_ADD_RUNTIME}\n` +
        "✘ [CLI.ABORTED] The command was aborted before it completed.\n",
    );
    expect(failed.exitCode).toBe(2);
    expect(errorOf(failed.json).code).toBe("CLI.PACKAGE_MANAGER_FAILED");
  });

  test("json mode: the cancelled operation's step closes before the abort", async () => {
    const controller = new AbortController();
    const { runner: record } = fakeManager(KILLED_CHILD);
    const aborting: PackageManagerRunner = async (request) => {
      controller.abort();
      return record(request);
    };

    const result = await cliWith({ runner: aborting }).run(JSON_MODE, {
      cwd: "/project",
      abort: controller.signal,
    });

    expect(result.exitCode).toBe(130);
    expect(result.json.map((frame) => frame.kind)).toEqual([
      "step-started",
      "output",
      "output",
      "step-finished",
      "result",
    ]);
    expect(
      result.json
        .filter((frame) => frame.kind === "step-finished")
        .map((frame) => frame.outcome),
    ).toEqual(["failed"]);
  });

  test("an operation begun after the abort announces nothing and runs nothing", async () => {
    const controller = new AbortController();
    const { calls, runner } = fakeManager();
    controller.abort();

    const result = await cliWith({ runner }).run(JSON_MODE, {
      cwd: "/project",
      abort: controller.signal,
    });

    expect(result.exitCode).toBe(130);
    expect(calls).toEqual([]);
    expect(result.events).toEqual([]);
  });
});

describe("a host that wires no runner", () => {
  test("json mode: the same code with reason runner-unavailable, and no step frames", async () => {
    const result = await cliWith({}).run(JSON_MODE, {
      cwd: "/project",
    });

    expect(result.exitCode).toBe(2);
    expect(result.events).toEqual([]);
    expect(result.json.map((frame) => frame.kind)).toEqual(["result"]);
    expect(errorOf(result.json)).toEqual<Diagnostic>({
      code: "CLI.PACKAGE_MANAGER_FAILED",
      severity: "error",
      summary: "Installing packages with pnpm failed.",
      why: "This host wires no package-manager runner, so nothing was run.",
      nextActions: [
        {
          kind: "run-command",
          label: "Run the install yourself",
          command: PNPM_ADD_RUNTIME,
        },
      ],
      meta: {
        form: "install",
        manager: "pnpm",
        command: PNPM_ADD_RUNTIME,
        exitCode: 1,
        stderrTail: "",
        reason: "runner-unavailable",
      },
    });
  });

  test("human mode: the error alone, with nothing announced as started", async () => {
    const result = await cliWith({}).run(HUMAN, { cwd: "/project" });

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "✘ [CLI.PACKAGE_MANAGER_FAILED] Installing packages with pnpm failed.\n" +
        "  why: This host wires no package-manager runner, so nothing was run.\n" +
        `→ Run the install yourself: ${PNPM_ADD_RUNTIME}\n`,
    );
  });
});

describe("two operations at once", () => {
  test("json mode: the second is a caller bug, exit 1, and never reaches the seam", async () => {
    const { calls, runner } = fakeManager();

    const result = await cliWith({ runner }).run(RACE_JSON, {
      cwd: "/project",
    });

    expect(result.exitCode).toBe(1);
    expect(calls).toEqual<SeamCall[]>([
      {
        file: "pnpm",
        args: ["add", "prisma@latest", "@prisma/client@latest"],
        cwd: "/project",
      },
    ]);
    expect(errorOf(result.json)).toEqual<Diagnostic>({
      code: "CLI.INTERNAL_ERROR",
      severity: "error",
      summary:
        "@prisma/cli-engine: ctx.packages runs one operation at a time, so two package managers can never write one project at once",
      nextActions: [],
    });
  });

  test("human mode: the operation that did run is framed, then the internal error", async () => {
    const { runner } = fakeManager();

    const result = await cliWith({ runner }).run(RACE_HUMAN, {
      cwd: "/project",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      `▸ ${PNPM_ADD_RUNTIME}\n` +
        "pnpm: resolving\n" +
        `✔ ${PNPM_ADD_RUNTIME}\n` +
        "✘ [CLI.INTERNAL_ERROR] @prisma/cli-engine: ctx.packages runs one operation at a time, so two package managers can never write one project at once\n",
    );
  });
});
