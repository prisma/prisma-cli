import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DeployProgress } from "@prisma/compute-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAuthState } from "../src/auth";
import type { AppProvider } from "../src/lib/app/app-provider";
import { createAppProvider } from "../src/lib/app/app-provider";
import { makeServiceCli, PROJECT, SIGNED_IN } from "./v8-service-testkit";

vi.mock("../src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth")>()),
  readAuthState: vi.fn(),
}));

vi.mock("../src/lib/app/app-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/app/app-provider")>()),
  createAppProvider: vi.fn(),
}));

const INTERACTIVE = { stdin: true, stdout: true, stderr: true };

interface FakeServiceRecord {
  id: string;
  name: string;
  region: string | null;
  liveDeploymentId: string | null;
  liveUrl: string | null;
}

interface FakeProviderOptions {
  services?: FakeServiceRecord[];
  deployments?: Array<{
    id: string;
    status: string;
    createdAt: string;
    url: string | null;
    live: boolean | null;
  }>;
  /** Drives the deploy callbacks; throws to simulate a failure mid-flight. */
  deploy?: (progress: DeployProgress | undefined) => void | Promise<void>;
  branchKind?: "production" | "preview";
  promoted?: boolean;
  envVars?: Array<{
    id: string;
    key: string;
    branchId: string | null;
    className: string;
  }>;
  createDatabaseFails?: boolean;
  createEnvVarFails?: boolean;
  deleteDatabaseFails?: boolean;
}

interface FakeProviderCalls {
  deployOptions: Record<string, unknown> | null;
  createdDatabases: string[];
  deletedDatabases: string[];
  createdEnvVars: Array<{ key: string; className: string }>;
  createdProjects: string[];
}

function installFakeProvider(options: FakeProviderOptions = {}): {
  calls: FakeProviderCalls;
} {
  const calls: FakeProviderCalls = {
    deployOptions: null,
    createdDatabases: [],
    deletedDatabases: [],
    createdEnvVars: [],
    createdProjects: [],
  };
  const services = options.services ?? [];
  const deployments = options.deployments ?? [];

  const provider = {
    listApps: async () => services,
    resolveBranch: async (
      _projectId: string,
      init: { branchName: string },
    ) => ({
      id: "br_1",
      name: init.branchName,
      role: options.branchKind ?? "production",
    }),
    listDeployments: async (serviceId: string) => ({
      app: services.find((service) => service.id === serviceId) ?? {
        id: serviceId,
        name: "hello-world",
        region: null,
        liveDeploymentId: null,
        liveUrl: null,
      },
      deployments,
    }),
    createProject: async (init: { name: string }) => {
      calls.createdProjects.push(init.name);
      return { id: "proj_new", name: init.name };
    },
    listEnvironmentVariables: async (init: { key: string }) =>
      (options.envVars ?? []).filter((row) => row.key === init.key),
    createEnvironmentVariable: async (init: {
      key: string;
      className: string;
    }) => {
      if (options.createEnvVarFails) {
        throw new Error("env var write rejected");
      }
      calls.createdEnvVars.push({ key: init.key, className: init.className });
      return { id: `env_${init.key}`, key: init.key, branchId: null };
    },
    updateEnvironmentVariable: async () => ({ id: "env_1" }),
    deleteEnvironmentVariable: async () => undefined,
    createBranchDatabase: async () => {
      if (options.createDatabaseFails) {
        throw new Error("database create rejected");
      }
      calls.createdDatabases.push("db_1");
      return {
        id: "db_1",
        name: "acme-db",
        databaseUrl: "postgres://db",
        directUrl: null,
      };
    },
    deleteBranchDatabase: async (init: { databaseId: string }) => {
      if (options.deleteDatabaseFails) {
        throw new Error("database delete rejected");
      }
      calls.deletedDatabases.push(init.databaseId);
    },
    deployApp: async (init: Record<string, unknown>) => {
      calls.deployOptions = init;
      const progress = init.progress as DeployProgress | undefined;
      if (options.deploy) {
        await options.deploy(progress);
      } else {
        progress?.onBuildStart?.();
        progress?.onBuildComplete?.({} as never);
        progress?.onArchiveCreating?.();
        progress?.onArchiveReady?.(1024);
        progress?.onDeploymentCreated?.("dep_new");
        progress?.onUploadStart?.();
        progress?.onUploadComplete?.();
        progress?.onStartRequested?.();
        progress?.onStatusChange?.("provisioning");
        progress?.onRunning?.("https://dep-new.prisma.app");
        if (options.promoted !== false) {
          progress?.onPromoteStart?.();
          progress?.onPromoted?.("hello.prisma.app");
        }
      }
      const promoted = options.promoted !== false;
      return {
        projectId: "proj_1",
        app: {
          id: "svc_1",
          name: "hello-world",
          region: "eu-central-1",
          liveDeploymentId: promoted ? "dep_new" : "dep_old",
          liveUrl: "https://hello.prisma.app",
        },
        deployment: {
          id: "dep_new",
          status: "running",
          url: "https://dep-new.prisma.app",
          live: promoted,
        },
        promoted,
      };
    },
  } as unknown as AppProvider;

  vi.mocked(createAppProvider).mockReturnValue(provider);
  return { calls };
}

const EXISTING_SERVICE: FakeServiceRecord = {
  id: "svc_1",
  name: "hello-world",
  region: "eu-central-1",
  liveDeploymentId: "dep_old",
  liveUrl: "https://hello.prisma.app",
};

const LIVE_DEPLOYMENT = {
  id: "dep_old",
  status: "running",
  createdAt: "2026-08-01T00:00:00.000Z",
  url: "https://dep-old.prisma.app",
  live: true,
};

function deployArgs(extra: string[] = []): string[] {
  return [
    "service",
    "deploy",
    "--project",
    "acme-app",
    "--framework",
    "nextjs",
    "--service",
    "hello-world",
    ...extra,
  ];
}

const PROJECT_ROUTES = {
  "GET /v1/projects": () => ({
    data: { data: [PROJECT], pagination: { hasMore: false, nextCursor: null } },
  }),
};

beforeEach(() => {
  vi.mocked(readAuthState).mockReset();
  vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);
  vi.mocked(createAppProvider).mockReset();
});

describe("prisma-v8 service deploy", () => {
  it("deploys, promotes, and reports the resolved settings", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      project: { id: "proj_1", name: "acme-app" },
      branch: { name: "main", kind: "production" },
      service: { id: "svc_1", name: "hello-world" },
      deployment: { id: "dep_new", status: "running", live: true },
      promoted: true,
      deploySettings: {
        framework: { key: "nextjs", buildType: "nextjs" },
        httpPort: 3000,
        region: "eu-central-1",
      },
    });
  });

  it("emits one step per deploy phase, in order, with the endpoints", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(), {
      cwd: harness.cwd,
      env: harness.env,
    });

    const steps = result.events
      .filter(
        (event) =>
          event.kind === "step-started" || event.kind === "step-finished",
      )
      .map(
        (event) =>
          `${(event as { step: string }).step}:${event.kind === "step-started" ? "start" : (event as { outcome: string }).outcome}`,
      );
    expect(steps).toEqual([
      "build:start",
      "build:ok",
      "archive:start",
      "archive:ok",
      "upload:start",
      "upload:ok",
      "deploy:start",
      "deploy:ok",
      "promote:start",
      "promote:ok",
    ]);
    expect(result.events).toContainEqual({
      kind: "endpoint",
      name: "deployment",
      url: "https://dep-new.prisma.app",
    });
    expect(result.events).toContainEqual({
      kind: "endpoint",
      name: "live",
      url: "https://hello.prisma.app",
    });
  });

  it("emits the completed json envelope with commandId service.deploy", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(["--json"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.deploy");
    expect(frame.envelope.result).toMatchObject({
      service: { name: "hello-world" },
      promoted: true,
    });
  });

  it("writes the selected service and the known live deployment", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    await harness.cli.run(deployArgs(), {
      cwd: harness.cwd,
      env: harness.env,
    });

    const state = JSON.parse(
      await readFile(path.join(harness.stateDir, "state.json"), "utf8"),
    );
    expect(state.app.selectedByProject.proj_1).toEqual({
      id: "svc_1",
      name: "hello-world",
    });
    expect(state.app.knownLiveDeploymentByProject.proj_1.svc_1).toBe("dep_new");
  });

  it("skips promotion and the production check with --no-promote", async () => {
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
      promoted: false,
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(["--no-promote"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ promoted: false });
    const steps = result.events
      .filter((event) => event.kind === "step-started")
      .map((event) => (event as { step: string }).step);
    expect(steps).not.toContain("promote");
  });

  it("requires --prod for a second production deploy", async () => {
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(["--json"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.PROD_DEPLOY_REQUIRES_FLAG");
  });

  it("deploys the first production version without --prod", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE], deployments: [] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.events).toContainEqual({
      kind: "message",
      severity: "info",
      text: 'First deploy of "hello-world" — promoting to production.',
    });
  });

  it("asks for type-to-confirm consent on a second production deploy and proceeds when granted", async () => {
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(["--prod"]), {
      cwd: harness.cwd,
      env: harness.env,
      isTty: INTERACTIVE,
      answers: ["hello-world"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ promoted: true });
  });

  it("settles a mistyped production consent token as the engine mismatch error", async () => {
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(["--prod"]), {
      cwd: harness.cwd,
      env: harness.env,
      isTty: INTERACTIVE,
      answers: ["not-the-service"],
    });

    expect(result.exitCode).toBe(2);
  });

  it("settles a non-interactive --prod run with the engine consent error", async () => {
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(["--prod", "--json"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
  });

  it("grants the production deploy non-interactively with --confirm <service>", async () => {
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(
      deployArgs(["--prod", "--confirm", "hello-world"]),
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ promoted: true });
  });

  it("refuses a --confirm value that is not the target service name", async () => {
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(
      deployArgs(["--prod", "--confirm", "some-other-service", "--json"]),
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
    expect(frame.envelope.error.meta).toMatchObject({
      consentToken: "hello-world",
    });
  });

  it("still requires --prod even when --confirm carries the service name", async () => {
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(
      deployArgs(["--confirm", "hello-world", "--json"]),
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.PROD_DEPLOY_REQUIRES_FLAG");
  });

  it("never lets --yes alone grant the production deploy", async () => {
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(
      deployArgs(["--prod", "--yes", "--json"]),
      { cwd: harness.cwd, env: harness.env, isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
  });

  it("creates and wires a branch database with --db", async () => {
    const { calls } = installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [],
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(["--db"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(calls.createdDatabases).toEqual(["db_1"]);
    expect(calls.createdEnvVars).toEqual([
      { key: "DATABASE_URL", className: "production" },
    ]);
    expect(result.presented?.data).toMatchObject({
      branchDatabase: {
        status: "created",
        database: { id: "db_1" },
        envVars: ["DATABASE_URL"],
      },
    });
    expect(result.events).toContainEqual({
      kind: "step-started",
      step: "branch-database",
    });
  });

  it("deletes the created database when wiring it fails", async () => {
    const { calls } = installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [],
      createEnvVarFails: true,
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(["--db", "--json"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(2);
    expect(calls.deletedDatabases).toEqual(["db_1"]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe(
      "SERVICE.BRANCH_DATABASE_SETUP_FAILED",
    );
  });

  it("refuses --db together with a provided DATABASE_URL", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE], deployments: [] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(
      deployArgs(["--db", "--env", "DATABASE_URL=postgres://x", "--json"]),
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe(
      "SERVICE.BRANCH_DATABASE_SETUP_FAILED",
    );
  });

  it("leaves existing production database env vars alone", async () => {
    const { calls } = installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [],
      envVars: [
        {
          id: "env_1",
          key: "DATABASE_URL",
          branchId: null,
          className: "production",
        },
      ],
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(["--db"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(calls.createdDatabases).toEqual([]);
    expect(result.presented?.data).toMatchObject({
      branchDatabase: {
        status: "skipped",
        reason: "production-env-exists",
      },
    });
  });

  it("reports a build-phase failure as SERVICE.BUILD_FAILED with the standalone-output hint", async () => {
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deploy: (progress) => {
        progress?.onBuildStart?.();
        throw new Error("Next.js requires standalone output for this build");
      },
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(["--json"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.BUILD_FAILED");
    expect(frame.envelope.error.meta).toMatchObject({ phase: "build" });
    const editAction = frame.envelope.error.nextActions.find(
      (action) => action.kind === "edit-file",
    );
    expect(editAction?.reason).toContain(
      'Add output: "standalone" to next.config.*',
    );
    expect(
      frame.envelope.error.nextActions.some((action) =>
        action.label.includes('Add output: "standalone" to next.config.*'),
      ),
    ).toBe(true);
  });

  it("reports a post-build failure with the deployment id and a logs action", async () => {
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deploy: (progress) => {
        progress?.onBuildStart?.();
        progress?.onBuildComplete?.({} as never);
        progress?.onDeploymentCreated?.("dep_new");
        progress?.onUploadStart?.();
        progress?.onUploadComplete?.();
        throw new Error("deployment did not start");
      },
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(deployArgs(["--json"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
    expect(frame.envelope.error.meta).toMatchObject({
      phase: "deploy",
      deploymentId: "dep_new",
    });
    expect(
      frame.envelope.error.nextActions.some((action) =>
        action.command?.includes("service logs --deployment dep_new"),
      ),
    ).toBe(true);
  });

  it("rejects --project together with --create-project", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(
      deployArgs(["--create-project", "other", "--json"]),
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.PROJECT_INPUTS_AMBIGUOUS");
  });

  it("reports PROJECT_SETUP_REQUIRED for an unlinked directory that cannot be asked", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(
      ["service", "deploy", "--framework", "nextjs", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.PROJECT_SETUP_REQUIRED");
    expect(frame.envelope.error.meta).toMatchObject({
      candidates: [{ id: "proj_1", name: "acme-app" }],
    });
  });

  it("creates and links a Project with --create-project", async () => {
    const { calls } = installFakeProvider({ services: [] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(
      [
        "service",
        "deploy",
        "--create-project",
        "brand-new",
        "--framework",
        "nextjs",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(calls.createdProjects).toEqual(["brand-new"]);
    expect(result.presented?.data).toMatchObject({
      localPin: { path: ".prisma/local.json", written: true },
    });
    const pin = JSON.parse(
      await readFile(path.join(harness.cwd, ".prisma/local.json"), "utf8"),
    );
    expect(pin.projectId).toBe("proj_new");
  });

  it("rejects an unsupported --framework value at parse time", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });

    const result = await harness.cli.run(
      ["service", "deploy", "--project", "acme-app", "--framework", "django"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE] });
    const harness = await makeServiceCli({
      authenticated: false,
      routes: PROJECT_ROUTES,
    });

    const result = await harness.cli.run(deployArgs(), {
      cwd: harness.cwd,
      env: harness.env,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});

describe("prisma-v8 service deploy (deploy-all)", () => {
  async function writeMultiTargetConfig(cwd: string): Promise<void> {
    await writeFile(
      path.join(cwd, "prisma.compute.mjs"),
      [
        "export default {",
        "  apps: {",
        '    web: { framework: "nextjs" },',
        '    api: { framework: "nextjs" },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  it("deploys every configured target in order, one step per target", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE], deployments: [] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });
    await writeMultiTargetConfig(harness.cwd);

    const result = await harness.cli.run(
      ["service", "deploy", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const targetSteps = result.events
      .filter((event) => event.kind === "step-started" && "id" in event)
      .map((event) => (event as { id?: string }).id)
      .filter((id): id is string => id !== undefined);
    expect(targetSteps).toEqual(["web", "api"]);
    expect(result.presented?.data).toMatchObject({
      deployments: [
        { target: "web", result: { promoted: true } },
        { target: "api", result: { promoted: true } },
      ],
    });
  });

  it("rejects per-service inputs when deploying every target", async () => {
    installFakeProvider({ services: [EXISTING_SERVICE], deployments: [] });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });
    await writeMultiTargetConfig(harness.cwd);

    const result = await harness.cli.run(
      [
        "service",
        "deploy",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe(
      "SERVICE.DEPLOY_ALL_INPUTS_REJECTED",
    );
    expect(frame.envelope.error.summary).toContain("--service");
  });

  it("carries completed and not-attempted targets when one fails", async () => {
    let deployCount = 0;
    installFakeProvider({
      services: [EXISTING_SERVICE],
      deployments: [],
      deploy: (progress) => {
        deployCount += 1;
        if (deployCount === 2) {
          progress?.onBuildStart?.();
          throw new Error("build blew up");
        }
        progress?.onBuildStart?.();
        progress?.onBuildComplete?.({} as never);
      },
    });
    const harness = await makeServiceCli({ routes: PROJECT_ROUTES });
    await writeMultiTargetConfig(harness.cwd);

    const result = await harness.cli.run(
      ["service", "deploy", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.meta).toMatchObject({
      deployAll: {
        failedTarget: "api",
        completed: [{ target: "web", deploymentId: "dep_new" }],
        notAttempted: [],
      },
    });
  });
});
