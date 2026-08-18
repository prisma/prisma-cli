/**
 * The `init` wizard on the engine. Assertions are semantic — the
 * envelope, the presented data, the events, the exit code — with one
 * deliberate exception: the config files init writes are data, not
 * rendering, so they are asserted byte for byte (R-S2d-1).
 *
 * Every test writes a skills-lock.json into its working directory so the
 * agent-setup offer finds the skill already installed and stays out of
 * the way; the offer itself is covered in init-agent-setup.test.ts.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ManagementApiClient } from "@prisma/cli-engine";
import { createTestCli, mintTestJwt } from "@prisma/cli-engine/testing";
import { COMPUTE_CONFIG_JSON_SCHEMA_URL } from "@prisma/compute-sdk/config";
import { beforeEach, describe, expect, it } from "vitest";

import { initCommand } from "../src/commands/init/init";
import { createTempCwd } from "./helpers";
import { writeSkillsLockWithSkill } from "./helpers/skills-lock";

const WORKSPACE_ID = "ws_123";

/** A node that exits 0 without touching the network — what the types
 *  install step runs instead of a real package manager. */
const FAKE_INSTALL = JSON.stringify(["node", "-e", "process.exit(0)"]);
const FAILING_INSTALL = JSON.stringify(["node", "-e", "process.exit(1)"]);

let cwd: string;

beforeEach(async () => {
  cwd = await createTempCwd();
  await writeSkillsLockWithSkill(cwd);
});

function sessionRecord(workspaceId: string) {
  return {
    workspaceId,
    workspaceName: "Acme",
    credential: {
      token: mintTestJwt({ workspace_id: workspaceId, sub: "usr_1" }),
      refreshToken: "r",
      expiresAt: undefined,
    },
  };
}

function apiWithProjects(
  projects: ReadonlyArray<{ id: string; name: string }>,
): ManagementApiClient {
  return {
    GET: async () => ({
      data: {
        data: projects.map((project) => ({
          ...project,
          slug: project.name,
          workspace: { id: WORKSPACE_ID, name: "Acme" },
        })),
      },
      response: { status: 200 },
    }),
  } as unknown as ManagementApiClient;
}

const OFFLINE_API = {
  GET: async () => {
    throw new Error("offline");
  },
} as unknown as ManagementApiClient;

function makeCli(spec?: {
  readonly signedIn?: boolean;
  readonly client?: ManagementApiClient;
}) {
  return createTestCli({
    commands: { init: initCommand },
    sessions: spec?.signedIn === true ? [sessionRecord(WORKSPACE_ID)] : [],
    selectedWorkspaceId: spec?.signedIn === true ? WORKSPACE_ID : undefined,
    managementApi: { client: spec?.client ?? OFFLINE_API },
    now: () => new Date(0),
  });
}

type RunOptions = Parameters<ReturnType<typeof makeCli>["run"]>[1];

function run(
  argv: readonly string[],
  opts?: RunOptions & {
    signedIn?: boolean;
    client?: ManagementApiClient;
  },
) {
  const { signedIn, client, ...runOpts } = opts ?? {};
  return makeCli({ signedIn, client }).run(argv, {
    cwd,
    ...runOpts,
    env: { PRISMA_CLI_INIT_INSTALL_COMMAND: FAKE_INSTALL, ...runOpts?.env },
  });
}

type ResultFrame = {
  readonly kind: string;
  readonly envelope: {
    readonly ok: boolean;
    readonly error?: Record<string, unknown>;
    readonly result?: unknown;
    readonly diagnostics?: ReadonlyArray<Record<string, unknown>>;
    readonly nextActions?: ReadonlyArray<Record<string, unknown>>;
  };
};

function envelopeOf(result: { readonly json: readonly unknown[] }) {
  const frame = (result.json as readonly ResultFrame[]).find(
    (candidate) => candidate.kind === "result",
  );
  if (frame === undefined) {
    throw new Error("expected a terminal result frame");
  }
  return frame.envelope;
}

function errorOf(result: { readonly json: readonly unknown[] }) {
  const envelope = envelopeOf(result);
  if (envelope.ok) {
    throw new Error("expected an errored result frame");
  }
  return envelope.error as Record<string, unknown>;
}

function resultOf(result: { readonly json: readonly unknown[] }) {
  const envelope = envelopeOf(result);
  if (!envelope.ok) {
    throw new Error(
      `expected an ok result frame, got ${JSON.stringify(envelope.error)}`,
    );
  }
  return envelope.result as Record<string, never>;
}

async function readConfig(directory = cwd): Promise<string> {
  return readFile(path.join(directory, "prisma.compute.ts"), "utf8");
}

async function readJsonConfig(directory = cwd): Promise<string> {
  return readFile(path.join(directory, "prisma.compute.json"), "utf8");
}

async function writePackageJson(
  directory: string,
  contents: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify(contents, null, 2)}\n`,
    "utf8",
  );
}

/** The compute SDK's canonical key order, which is what "byte-identical
 *  to the legacy command" means: both call the same serializer. */
const BILLING_API_TS =
  `import { defineComputeConfig } from "@prisma/compute-sdk/config";\n` +
  `\n` +
  `export default defineComputeConfig({\n` +
  `  app: {\n` +
  `    name: "billing-api",\n` +
  `    region: "us-east-1",\n` +
  `    framework: "hono",\n` +
  `    entry: "src/index.ts",\n` +
  `    httpPort: 8080,\n` +
  `  },\n` +
  `});\n`;

describe("init writes the config", () => {
  it("writes a config for an explicit framework without auth or prompts", async () => {
    await writePackageJson(cwd, { name: "billing-api" });

    const result = await run([
      "init",
      "--framework",
      "hono",
      "--entry",
      "src/index.ts",
      "--no-install",
      "--no-link",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      configPath: "prisma.compute.ts",
      format: "typescript",
      converted: false,
      app: {
        name: "billing-api",
        framework: "hono",
        entry: "src/index.ts",
        httpPort: 3000,
      },
      types: {
        status: "skipped",
        package: "@prisma/compute-sdk",
        installCommand: "npm install -D @prisma/compute-sdk",
      },
      link: { status: "skipped", project: null },
    });
  });

  it("writes the exact bytes the compute SDK serializes", async () => {
    await writePackageJson(cwd, { name: "billing-api" });

    await run([
      "init",
      "--framework",
      "hono",
      "--entry",
      "src/index.ts",
      "--http-port",
      "8080",
      "--region",
      "us-east-1",
      "--no-install",
      "--no-link",
      "--json",
    ]);

    expect(await readConfig()).toBe(BILLING_API_TS);
  });

  it("appends the commented build stub for the custom framework, byte for byte", async () => {
    await run([
      "init",
      "--framework",
      "custom",
      "--name",
      "api",
      "--no-install",
      "--no-link",
      "--json",
    ]);

    expect(await readConfig()).toContain(
      `\n` +
        `// framework "custom" deploys a prebuilt artifact. Add its build settings:\n` +
        `// build: {\n` +
        `//   command: "npm run build",\n` +
        `//   outputDirectory: "dist",\n` +
        `//   entrypoint: "server.js",\n` +
        `// },\n`,
    );
  });

  it("writes prisma.compute.json byte for byte under --config-format json", async () => {
    await writePackageJson(cwd, { name: "billing-api" });

    const result = await run([
      "init",
      "--framework",
      "hono",
      "--entry",
      "src/index.ts",
      "--no-link",
      "--config-format",
      "json",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      configPath: "prisma.compute.json",
      format: "json",
      // The JSON format is dependency-free by design, so the types step
      // never runs and offers no install hint.
      types: {
        status: "skipped",
        package: "@prisma/compute-sdk",
        installCommand: null,
      },
    });
    expect(await readJsonConfig()).toBe(
      `{\n` +
        `  "app": {\n` +
        `    "name": "billing-api",\n` +
        `    "framework": "hono",\n` +
        `    "entry": "src/index.ts",\n` +
        `    "httpPort": 3000\n` +
        `  }\n` +
        `}\n`,
    );
    await expect(readConfig()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("detects the framework from the directory and uses its default port", async () => {
    await writePackageJson(cwd, { name: "web" });
    await writeFile(path.join(cwd, "next.config.ts"), "export default {};\n");

    const result = await run(["init", "--no-install", "--no-link", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      app: { name: "web", framework: "nextjs", httpPort: 3000 },
    });
    expect(resultOf(result).settings).toContainEqual(
      expect.objectContaining({
        key: "framework",
        source: expect.stringContaining("next.config.ts"),
      }),
    );
  });

  it("falls back to the directory name when package.json has none", async () => {
    const result = await run([
      "init",
      "--framework",
      "hono",
      "--no-install",
      "--no-link",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      app: { name: path.basename(cwd) },
      directory: `./${path.basename(cwd)}`,
    });
  });

  it("previews the settings, reports the write as a step, and puts the path on stdout", async () => {
    const result = await run(
      [
        "init",
        "--framework",
        "hono",
        "--name",
        "api",
        "--http-port",
        "8080",
        "--no-install",
        "--no-link",
      ],
      { isTty: { stdout: true, stderr: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.events).toContainEqual({
      kind: "message",
      severity: "info",
      text:
        "  app        api   flag\n" +
        "  framework  Hono  flag\n" +
        "  http port  8080  flag",
    });
    expect(result.events).toContainEqual({
      kind: "step-finished",
      step: "write-config",
      outcome: "ok",
      data: { path: "prisma.compute.ts" },
    });
    // Both streams are the same terminal here, so the machine mirror is
    // suppressed; the path still travels in the presented stdout lines.
    expect(result.stdout).toBe("");
    expect(result.presented?.presentation.stdout).toEqual([
      "prisma.compute.ts",
    ]);
    expect(result.presented?.presentation.human).toContainEqual({
      kind: "summary",
      status: "ok",
      text: "Wrote prisma.compute.ts",
    });
  });

  it("offers deploy and link as next actions when nothing is linked", async () => {
    const result = await run([
      "init",
      "--framework",
      "hono",
      "--name",
      "api",
      "--no-install",
      "--no-link",
      "--json",
    ]);

    expect(envelopeOf(result).nextActions).toEqual([
      expect.objectContaining({
        command: "npm install -D @prisma/compute-sdk",
      }),
      expect.objectContaining({
        command: "npx -y @prisma/cli@next git connect",
      }),
      expect.objectContaining({
        command: "npx -y @prisma/cli@next project link",
      }),
    ]);
  });
});

describe("init refuses to clobber", () => {
  it("fails with INIT.CONFIG_EXISTS here and in an ancestor", async () => {
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      'export default { app: { framework: "hono" } };\n',
    );

    const direct = await run(["init", "--framework", "hono", "--json"]);
    expect(direct.exitCode).toBe(2);
    expect(errorOf(direct).code).toBe("INIT.CONFIG_EXISTS");
    expect(errorOf(direct).meta).toMatchObject({
      existingConfigPath: expect.stringContaining("prisma.compute.ts"),
    });

    await mkdir(path.join(cwd, ".git"), { recursive: true });
    const nested = path.join(cwd, "apps", "api");
    await mkdir(nested, { recursive: true });
    const fromNested = await makeCli().run(
      ["init", "--framework", "hono", "--json"],
      { cwd: nested },
    );
    expect(fromNested.exitCode).toBe(2);
    expect(errorOf(fromNested).code).toBe("INIT.CONFIG_EXISTS");
  });

  it("refuses plain init and a repeated --config-format json over prisma.compute.json", async () => {
    await writeFile(
      path.join(cwd, "prisma.compute.json"),
      `${JSON.stringify({ app: { framework: "hono" } })}\n`,
    );

    for (const argv of [
      ["init", "--framework", "hono", "--json"],
      ["init", "--framework", "hono", "--config-format", "json", "--json"],
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: both spellings run in the same sandbox directory, so the first must settle before the second checks the same file.
      const result = await run(argv);
      expect(result.exitCode).toBe(2);
      expect(errorOf(result).code).toBe("INIT.CONFIG_EXISTS");
      expect(errorOf(result).meta).toMatchObject({
        existingConfigPath: expect.stringContaining("prisma.compute.json"),
      });
    }
  });

  it("fails with INIT.CONVERT_UNSUPPORTED for a TypeScript config and --config-format json", async () => {
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      'export default { app: { framework: "hono" } };\n',
    );

    const result = await run([
      "init",
      "--framework",
      "hono",
      "--config-format",
      "json",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result).code).toBe("INIT.CONVERT_UNSUPPORTED");
    await expect(readJsonConfig()).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("init argument validation", () => {
  it("rejects a bad port, region and framework before writing anything", async () => {
    const cases: ReadonlyArray<readonly [readonly string[], string]> = [
      [
        ["init", "--framework", "hono", "--http-port", "70000", "--json"],
        "INIT.HTTP_PORT_INVALID",
      ],
      [
        ["init", "--framework", "hono", "--region", "mars-1", "--json"],
        "INIT.REGION_UNKNOWN",
      ],
      [["init", "--framework", "rails", "--json"], "INIT.FRAMEWORK_UNKNOWN"],
      [
        ["init", "--framework", "hono", "--name", "  ", "--json"],
        "INIT.NAME_EMPTY",
      ],
      [
        ["init", "--framework", "nextjs", "--entry", "src/index.ts", "--json"],
        "INIT.ENTRY_UNSUPPORTED",
      ],
      [
        [
          "init",
          "--framework",
          "hono",
          "--install",
          "--config-format",
          "json",
          "--json",
        ],
        "INIT.INSTALL_NOT_APPLICABLE",
      ],
      [
        ["init", "--framework", "custom", "--config-format", "json", "--json"],
        "INIT.CUSTOM_FRAMEWORK_NEEDS_TYPESCRIPT",
      ],
    ];

    for (const [argv, code] of cases) {
      // biome-ignore lint/performance/noAwaitInLoops: the cases share one sandbox, and the per-case failure message needs them one at a time.
      const result = await run(argv);
      expect(result.exitCode, code).toBe(2);
      expect(errorOf(result).code).toBe(code);
    }

    await expect(readConfig()).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readJsonConfig()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an unknown --config-format value through the engine's parser", async () => {
    const result = await run([
      "init",
      "--framework",
      "hono",
      "--config-format",
      "yaml",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result).code).toBe("CLI.INVALID_ARGUMENTS");
  });

  it("fails with INIT.DETECTION_FAILED when nothing is detectable and nobody can be asked", async () => {
    const result = await run(["init", "--no-install", "--no-link", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result).code).toBe("INIT.DETECTION_FAILED");
    expect(errorOf(result).meta).toMatchObject({
      frameworks: expect.arrayContaining(["hono"]),
    });
  });
});

describe("init prompt modes", () => {
  it("interactive: asks for a framework when detection finds nothing", async () => {
    const result = await run(["init", "--no-install", "--no-link", "--json"], {
      isTty: { stdin: true },
      answers: ["hono", false],
    });

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      app: { framework: "hono" },
      settings: expect.arrayContaining([
        { key: "framework", value: "Hono", source: "selected" },
      ]),
    });
  });

  it("interactive: adjusts the framework and port when the user says yes", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      ["init", "--framework", "hono", "--no-install", "--no-link", "--json"],
      { isTty: { stdin: true }, answers: [true, "nextjs", "4321"] },
    );

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      app: { framework: "nextjs", httpPort: 4321 },
    });
  });

  it("interactive: keeps the resolved settings when the adjust prompt is declined", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      ["init", "--framework", "hono", "--no-install", "--no-link", "--json"],
      { isTty: { stdin: true }, answers: [false] },
    );

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      app: { framework: "hono", httpPort: 3000 },
    });
  });

  it("interactive: an out-of-range port typed at the adjust prompt is rejected", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      ["init", "--framework", "hono", "--no-install", "--no-link", "--json"],
      { isTty: { stdin: true }, answers: [true, "hono", "70000"] },
    );

    expect(result.exitCode).toBe(2);
    expect(errorOf(result).code).toBe("INIT.HTTP_PORT_INVALID");
  });

  it("--yes takes every prompt default: settings as resolved, no install, no link", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run([
      "init",
      "--framework",
      "hono",
      "--yes",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      app: { framework: "hono", httpPort: 3000 },
      types: { status: "declined" },
      link: { status: "declined", project: null },
    });
    expect(await readConfig()).toContain('framework: "hono"');
  });

  it("non-interactive takes the same defaults as --yes", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(["init", "--framework", "hono", "--json"], {
      signedIn: true,
      client: apiWithProjects([{ id: "proj_1", name: "One" }]),
    });

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      types: { status: "declined" },
      link: { status: "declined", project: null },
    });
    await expect(
      readFile(path.join(cwd, ".prisma/local.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancelled before the write settles at exit 3 and writes nothing", async () => {
    const result = await run(["init", "--no-install", "--no-link", "--json"], {
      isTty: { stdin: true },
      stdin: "",
    });

    expect(result.exitCode).toBe(3);
    expect(errorOf(result).code).toBe("CLI.PROMPT_CANCELLED");
    await expect(readConfig()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancelled at the link question settles at exit 3, leaving the written config", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      ["init", "--framework", "hono", "--no-install", "--json"],
      { isTty: { stdin: true }, stdin: "n\n" },
    );

    expect(result.exitCode).toBe(3);
    expect(errorOf(result).code).toBe("CLI.PROMPT_CANCELLED");
    expect(await readConfig()).toContain('framework: "hono"');
  });
});

describe("init types install", () => {
  it("reports already-installed when the sdk is a devDependency", async () => {
    await writePackageJson(cwd, {
      name: "api",
      devDependencies: { "@prisma/compute-sdk": "^0.1.0" },
    });

    const result = await run([
      "init",
      "--framework",
      "hono",
      "--no-link",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result).types).toEqual({
      status: "already-installed",
      package: "@prisma/compute-sdk",
      installCommand: null,
    });
    expect(envelopeOf(result).nextActions).not.toContainEqual(
      expect.objectContaining({
        command: "npm install -D @prisma/compute-sdk",
      }),
    );
  });

  it("skips with --no-install and keeps the hint as a next action", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run([
      "init",
      "--framework",
      "hono",
      "--no-install",
      "--no-link",
      "--json",
    ]);

    expect(resultOf(result).types).toMatchObject({ status: "skipped" });
    expect(envelopeOf(result).nextActions).toContainEqual(
      expect.objectContaining({
        command: "npm install -D @prisma/compute-sdk",
      }),
    );
  });

  it("installs with --install and reports success without findings", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run([
      "init",
      "--framework",
      "hono",
      "--install",
      "--no-link",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result).types).toMatchObject({ status: "installed" });
    expect(envelopeOf(result).diagnostics).toEqual([]);
    expect(result.events).toContainEqual({
      kind: "step-finished",
      step: "install-types",
      outcome: "ok",
      data: { status: "installed" },
    });
  });

  it("installs when the prompt is answered yes", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      ["init", "--framework", "hono", "--no-link", "--json"],
      { isTty: { stdin: true }, answers: [false, true] },
    );

    expect(resultOf(result).types).toMatchObject({ status: "installed" });
  });

  it("declines the install when the prompt is answered no", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      ["init", "--framework", "hono", "--no-link", "--json"],
      { isTty: { stdin: true }, answers: [false, false] },
    );

    expect(resultOf(result).types).toMatchObject({ status: "declined" });
  });

  it("downgrades a failed install to a warn diagnostic and keeps the config", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      ["init", "--framework", "hono", "--install", "--no-link", "--json"],
      { env: { PRISMA_CLI_INIT_INSTALL_COMMAND: FAILING_INSTALL } },
    );

    expect(result.exitCode).toBe(0);
    expect(resultOf(result).types).toMatchObject({ status: "failed" });
    expect(envelopeOf(result).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INIT.TYPES_INSTALL_FAILED",
        severity: "warn",
      }),
    );
    expect(await readConfig()).toContain('framework: "hono"');
  });

  it("keeps the written config when package.json cannot be read", async () => {
    await writeFile(path.join(cwd, "package.json"), "{ not json", "utf8");

    const result = await run([
      "init",
      "--framework",
      "hono",
      "--entry",
      "src/index.ts",
      "--name",
      "api",
      "--install",
      "--no-link",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result).types).toMatchObject({ status: "skipped" });
    expect(envelopeOf(result).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INIT.TYPES_PACKAGE_JSON_UNREADABLE",
      }),
    );
    expect(await readConfig()).toContain('framework: "hono"');
  });
});

describe("init link step", () => {
  it("links to an explicit --project and writes the pin", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      [
        "init",
        "--framework",
        "hono",
        "--no-install",
        "--project",
        "proj_123",
        "--json",
      ],
      {
        signedIn: true,
        client: apiWithProjects([{ id: "proj_123", name: "Acme Dashboard" }]),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(resultOf(result).link).toEqual({
      status: "linked",
      project: { id: "proj_123", name: "Acme Dashboard" },
    });
    expect(
      JSON.parse(await readFile(path.join(cwd, ".prisma/local.json"), "utf8")),
    ).toEqual({ workspaceId: WORKSPACE_ID, projectId: "proj_123" });
    expect(envelopeOf(result).nextActions).not.toContainEqual(
      expect.objectContaining({
        command: "npx -y @prisma/cli@next project link",
      }),
    );
  });

  it("reads the auth state instead of forcing a login, and offers sign-in", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run([
      "init",
      "--framework",
      "hono",
      "--no-install",
      "--project",
      "proj_123",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result).link).toEqual({
      status: "unauthenticated",
      project: null,
    });
    expect(envelopeOf(result).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INIT.LINK_REQUIRES_SIGN_IN",
        severity: "warn",
        nextActions: [
          expect.objectContaining({ command: "prisma-cli auth login" }),
        ],
      }),
    );
    expect(await readConfig()).toContain('framework: "hono"');
  });

  it("downgrades a project that does not exist to a warn diagnostic", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      [
        "init",
        "--framework",
        "hono",
        "--no-install",
        "--project",
        "nope",
        "--json",
      ],
      { signedIn: true, client: apiWithProjects([]) },
    );

    expect(result.exitCode).toBe(0);
    expect(resultOf(result).link).toMatchObject({ status: "failed" });
    expect(envelopeOf(result).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INIT.LINK_FAILED",
        summary: expect.stringContaining("Project link failed"),
      }),
    );
  });

  it("reports an already-linked directory without asking", async () => {
    await writePackageJson(cwd, { name: "api" });
    await mkdir(path.join(cwd, ".prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, ".prisma/local.json"),
      `${JSON.stringify({ workspaceId: WORKSPACE_ID, projectId: "proj_9" })}\n`,
    );

    const result = await run([
      "init",
      "--framework",
      "hono",
      "--no-install",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result).link).toEqual({
      status: "already-linked",
      project: null,
    });
  });

  it("picks a project through the same picker project link uses", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      ["init", "--framework", "hono", "--no-install", "--link", "--json"],
      {
        signedIn: true,
        client: apiWithProjects([
          { id: "proj_1", name: "One" },
          { id: "proj_2", name: "Two" },
        ]),
        isTty: { stdin: true },
        answers: [false, "proj_2"],
      },
    );

    expect(result.exitCode).toBe(0);
    expect(resultOf(result).link).toEqual({
      status: "linked",
      project: { id: "proj_2", name: "Two" },
    });
  });

  it("offers the picker's cancel choice, which downgrades to a warning", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      ["init", "--framework", "hono", "--no-install", "--link", "--json"],
      {
        signedIn: true,
        client: apiWithProjects([{ id: "proj_1", name: "One" }]),
        isTty: { stdin: true },
        answers: [false, "__cancel__"],
      },
    );

    expect(result.exitCode).toBe(0);
    expect(resultOf(result).link).toMatchObject({ status: "failed" });
    expect(envelopeOf(result).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INIT.LINK_FAILED",
        summary: expect.stringContaining("Project setup canceled"),
      }),
    );
  });

  it("declines the link when the question is answered no", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      ["init", "--framework", "hono", "--no-install", "--json"],
      { isTty: { stdin: true }, answers: [false, false] },
    );

    expect(resultOf(result).link).toEqual({
      status: "declined",
      project: null,
    });
  });

  it("has nobody to answer the picker under --link non-interactively, so the step warns", async () => {
    await writePackageJson(cwd, { name: "api" });

    const result = await run(
      ["init", "--framework", "hono", "--no-install", "--link", "--json"],
      {
        signedIn: true,
        client: apiWithProjects([
          { id: "proj_1", name: "One" },
          { id: "proj_2", name: "Two" },
        ]),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(resultOf(result).link).toMatchObject({ status: "failed" });
    expect(envelopeOf(result).diagnostics).toContainEqual(
      expect.objectContaining({ code: "INIT.LINK_FAILED" }),
    );
  });
});

describe("init conversion", () => {
  const jsonConfig = `${JSON.stringify(
    {
      $schema: COMPUTE_CONFIG_JSON_SCHEMA_URL,
      app: {
        name: "billing-api",
        framework: "hono",
        entry: "src/index.ts",
        httpPort: 8080,
        region: "us-east-1",
      },
    },
    null,
    2,
  )}\n`;

  it("converts prisma.compute.json to prisma.compute.ts byte for byte", async () => {
    await writeFile(path.join(cwd, "prisma.compute.json"), jsonConfig);

    const result = await run([
      "init",
      "--config-format",
      "ts",
      "--no-install",
      "--no-link",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      configPath: "prisma.compute.ts",
      format: "typescript",
      converted: true,
      app: {
        name: "billing-api",
        framework: "hono",
        entry: "src/index.ts",
        httpPort: 8080,
        region: "us-east-1",
      },
    });
    expect(resultOf(result).settings).toContainEqual({
      key: "framework",
      value: "Hono",
      source: "prisma.compute.json",
    });
    expect(await readConfig()).toBe(BILLING_API_TS);
    await expect(readJsonConfig()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports no app identity for a multi-app config", async () => {
    await writeFile(
      path.join(cwd, "prisma.compute.json"),
      `${JSON.stringify({
        apps: {
          web: {
            framework: "nextjs",
            root: "apps/web",
            build: { command: null },
          },
          api: {
            framework: "hono",
            root: "apps/api",
            entry: "src/index.ts",
          },
        },
      })}\n`,
    );

    const result = await run([
      "init",
      "--config-format",
      "ts",
      "--no-install",
      "--no-link",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({ converted: true, app: null });
    // Nothing to preview when no single app was transported.
    expect(result.events).not.toContainEqual(
      expect.objectContaining({ kind: "message" }),
    );
    expect(await readConfig()).toContain("command: null");
  });

  it("rejects resolution flags during conversion and changes nothing on disk", async () => {
    const source = `${JSON.stringify({
      app: { name: "api", framework: "hono", httpPort: 8080 },
    })}\n`;
    await writeFile(path.join(cwd, "prisma.compute.json"), source);

    const result = await run([
      "init",
      "--config-format",
      "ts",
      "--framework",
      "nextjs",
      "--http-port",
      "3000",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result).code).toBe("INIT.CONVERSION_FLAGS_NOT_APPLICABLE");
    expect(errorOf(result).summary).toContain("--framework");
    expect(errorOf(result).summary).toContain("--http-port");
    await expect(readConfig()).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readJsonConfig()).toBe(source);
  });

  it("fails with INIT.COMPUTE_CONFIG_INVALID for a malformed JSON config", async () => {
    await writeFile(path.join(cwd, "prisma.compute.json"), "{ not json");

    const result = await run(["init", "--config-format", "ts", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result).code).toBe("INIT.COMPUTE_CONFIG_INVALID");
    await expect(readConfig()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("runs the conversion's side effects where the config lives, not where init ran", async () => {
    await mkdir(path.join(cwd, ".git"), { recursive: true });
    await writePackageJson(cwd, { name: "root-app" });
    await writeFile(
      path.join(cwd, "prisma.compute.json"),
      `${JSON.stringify({ app: { framework: "hono", httpPort: 8080 } })}\n`,
    );
    const nested = path.join(cwd, "apps", "api");
    await mkdir(nested, { recursive: true });
    await writePackageJson(nested, { name: "api" });

    const result = await makeCli({
      signedIn: true,
      client: apiWithProjects([{ id: "proj_123", name: "Acme Dashboard" }]),
    }).run(
      [
        "init",
        "--config-format",
        "ts",
        "--install",
        "--project",
        "proj_123",
        "--json",
      ],
      {
        cwd: nested,
        env: {
          // The fake installer records where it ran.
          PRISMA_CLI_INIT_INSTALL_COMMAND: JSON.stringify([
            "node",
            "-e",
            "require('fs').writeFileSync('install-cwd.txt','ok')",
          ]),
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      configPath: path.join("..", "..", "prisma.compute.ts"),
      types: { status: "installed" },
      link: { status: "linked", project: { id: "proj_123" } },
    });
    await expect(
      readFile(path.join(cwd, "install-cwd.txt"), "utf8"),
    ).resolves.toBe("ok");
    await expect(
      readFile(path.join(nested, "install-cwd.txt"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(cwd, ".prisma/local.json"), "utf8"),
    ).resolves.toContain("proj_123");
    await expect(
      readFile(path.join(nested, ".prisma/local.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("presents the conversion summary in human mode", async () => {
    await writeFile(
      path.join(cwd, "prisma.compute.json"),
      `${JSON.stringify({ app: { framework: "hono", httpPort: 8080 } })}\n`,
    );

    const result = await run(
      ["init", "--config-format", "ts", "--no-install", "--no-link"],
      { isTty: { stdout: true, stderr: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.presentation.human).toContainEqual({
      kind: "summary",
      status: "ok",
      text: "Converted prisma.compute.json to prisma.compute.ts",
    });
  });
});
