import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DeployError,
  DeployOptions,
  DeployProgress,
  DeployResult,
} from "@prisma/compute-sdk";
import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAuthState } from "../src/auth";
import {
  makeServiceCli,
  PROJECT,
  page,
  presentedSummary,
  type RawDeployment,
  type RawService,
  type Routes,
  SIGNED_IN,
} from "./v8-service-testkit";

vi.mock("../src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth")>()),
  readAuthState: vi.fn(),
}));

const deployFake = vi.hoisted(() => ({
  run: null as
    | ((options: DeployOptions) => Promise<Result<DeployResult, DeployError>>)
    | null,
}));

/**
 * The compute SDK's deploy is the one call no HTTP fake reaches: it builds
 * an artifact on disk, uploads it, and reports progress through callbacks.
 * Everything else `service deploy` drives — the project, branch, service,
 * database and environment-variable calls, and the mapping of the deploy
 * response itself — runs for real against the routes below.
 */
vi.mock("@prisma/compute-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/compute-sdk")>();
  return {
    ...actual,
    ComputeClient: class extends actual.ComputeClient {
      deploy(options: DeployOptions) {
        if (!deployFake.run) {
          throw new Error("v8-service-deploy: no deploy fake installed");
        }
        return deployFake.run(options);
      }
    },
  };
});

const INTERACTIVE = { stdin: true, stdout: true, stderr: true };

interface RawEnvironmentVariable {
  id: string;
  key: string;
  branchId: string | null;
  class: "production" | "preview";
  isManagedBySystem: boolean;
}

interface DeployCliOptions {
  services?: RawService[];
  deployments?: RawDeployment[];
  envVars?: RawEnvironmentVariable[];
  branchRole?: "production" | "preview";
  /** Whether a created database reports a direct connection endpoint. */
  databaseDirectUrl?: boolean;
  createDatabaseFails?: boolean;
  createEnvVarFails?: boolean;
  deleteDatabaseFails?: boolean;
  authenticated?: boolean;
  /** Drives the deploy callbacks; throws to simulate a failure mid-flight. */
  deploy?: (progress: DeployProgress | undefined) => void | Promise<void>;
  promoted?: boolean;
}

interface DeployApiCalls {
  createdProjects: string[];
  createdServices: string[];
  createdDatabases: string[];
  deletedDatabases: string[];
  createdEnvVars: Array<{ key: string; className: string }>;
  updatedEnvVars: string[];
  deletedEnvVars: string[];
}

function apiError(message: string, status: number) {
  return { error: { error: { message } }, status };
}

function deployRoutes(options: DeployCliOptions): {
  routes: Routes;
  calls: DeployApiCalls;
} {
  const calls: DeployApiCalls = {
    createdProjects: [],
    createdServices: [],
    createdDatabases: [],
    deletedDatabases: [],
    createdEnvVars: [],
    updatedEnvVars: [],
    deletedEnvVars: [],
  };
  const services = options.services ?? [];
  const deployments = options.deployments ?? [];
  const envVars = options.envVars ?? [];

  const routes: Routes = {
    "GET /v1/projects": () => ({ data: page([PROJECT]) }),
    "POST /v1/projects": (init) => {
      const body = init.body as { name: string };
      calls.createdProjects.push(body.name);
      return {
        data: {
          data: { id: "proj_new", name: body.name, defaultRegion: null },
        },
      };
    },
    "GET /v1/projects/{projectId}/branches": (init) => ({
      data: page([
        {
          id: "br_1",
          gitName:
            (init.params?.query?.gitName as string | undefined) ?? "main",
          isDefault: true,
          role: options.branchRole ?? "production",
        },
      ]),
    }),
    "GET /v1/apps": () => ({ data: page(services) }),
    "POST /v1/apps": (init) => {
      const body = init.body as { displayName: string; regionId?: string };
      calls.createdServices.push(body.displayName);
      return {
        data: {
          data: {
            id: "svc_new",
            name: body.displayName,
            region: { id: body.regionId ?? null },
            branchId: "br_1",
            latestDeploymentId: null,
            appEndpointDomain: null,
          },
        },
      };
    },
    "GET /v1/apps/{appId}": (init) => {
      const id = init.params?.path?.appId;
      const service = services.find((candidate) => candidate.id === id);
      return service
        ? { data: { data: { ...service, projectId: PROJECT.id } } }
        : apiError("not found", 404);
    },
    "GET /v1/apps/{appId}/deployments": () => ({ data: page(deployments) }),
    "GET /v1/deployments/{deploymentId}": (init) => {
      const id = init.params?.path?.deploymentId;
      const deployment = deployments.find((candidate) => candidate.id === id);
      return deployment
        ? { data: { data: deployment } }
        : apiError("not found", 404);
    },
    "GET /v1/environment-variables": (init) => {
      const query = (init.params?.query ?? {}) as {
        key?: string;
        class?: string;
        branchId?: string;
      };
      return {
        data: page(
          envVars.filter(
            (row) =>
              (query.key === undefined || row.key === query.key) &&
              (query.class === undefined || row.class === query.class) &&
              (query.branchId === undefined || row.branchId === query.branchId),
          ),
        ),
      };
    },
    "POST /v1/environment-variables": (init) => {
      if (options.createEnvVarFails) {
        return apiError("env var write rejected", 500);
      }
      const body = init.body as {
        key: string;
        class: "production" | "preview";
        branchId?: string;
      };
      calls.createdEnvVars.push({ key: body.key, className: body.class });
      return {
        data: {
          data: {
            id: `env_${body.key}`,
            key: body.key,
            branchId: body.branchId ?? null,
            class: body.class,
            isManagedBySystem: false,
          },
        },
      };
    },
    "PATCH /v1/environment-variables/{envVarId}": (init) => {
      const id = init.params?.path?.envVarId as string;
      calls.updatedEnvVars.push(id);
      const existing = envVars.find((row) => row.id === id);
      return {
        data: {
          data: existing ?? {
            id,
            key: "DATABASE_URL",
            branchId: null,
            class: "production",
            isManagedBySystem: false,
          },
        },
      };
    },
    "DELETE /v1/environment-variables/{envVarId}": (init) => {
      calls.deletedEnvVars.push(init.params?.path?.envVarId as string);
      return { data: { data: {} } };
    },
    "POST /v1/databases": () => {
      if (options.createDatabaseFails) {
        return apiError("database create rejected", 500);
      }
      calls.createdDatabases.push("db_1");
      return {
        data: {
          data: {
            id: "db_1",
            name: "acme-db",
            branchId: "br_1",
            connections: [
              {
                endpoints: {
                  pooled: { connectionString: "postgres://db" },
                  ...(options.databaseDirectUrl
                    ? { direct: { connectionString: "postgres://db-direct" } }
                    : {}),
                },
              },
            ],
          },
        },
      };
    },
    "DELETE /v1/databases/{databaseId}": (init) => {
      if (options.deleteDatabaseFails) {
        return apiError("database delete rejected", 500);
      }
      calls.deletedDatabases.push(init.params?.path?.databaseId as string);
      return { data: { data: {} } };
    },
  };

  return { routes, calls };
}

function installDeployFake(options: DeployCliOptions): void {
  const promoted = options.promoted !== false;
  deployFake.run = async (deployOptions) => {
    const progress = deployOptions.progress as DeployProgress | undefined;
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
      if (promoted) {
        progress?.onPromoteStart?.();
        progress?.onPromoted?.("hello.prisma.app");
      }
    }
    return Result.ok({
      projectId: deployOptions.projectId,
      appId: deployOptions.appId ?? "svc_1",
      appName: deployOptions.appName ?? "hello-world",
      region: deployOptions.region ?? "eu-central-1",
      deploymentId: "dep_new",
      deploymentEndpointDomain: "dep-new.prisma.app",
      appEndpointDomain: promoted ? "hello.prisma.app" : null,
      promoted,
      previousDeploymentId: promoted ? null : "dep_old",
      previousDeploymentAction: null,
    } as DeployResult);
  };
}

async function makeDeployCli(options: DeployCliOptions = {}) {
  const { routes, calls } = deployRoutes(options);
  installDeployFake(options);
  const harness = await makeServiceCli({
    routes,
    ...(options.authenticated === false ? { authenticated: false } : {}),
  });
  return { ...harness, calls };
}

const EXISTING_SERVICE: RawService = {
  id: "svc_1",
  name: "hello-world",
  region: { id: "eu-central-1" },
  branchId: "br_1",
  latestDeploymentId: "dep_old",
  appEndpointDomain: "hello.prisma.app",
};

const LIVE_DEPLOYMENT: RawDeployment = {
  id: "dep_old",
  status: "running",
  createdAt: "2026-08-01T00:00:00.000Z",
  previewDomain: "dep-old.prisma.app",
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

beforeEach(() => {
  vi.mocked(readAuthState).mockReset();
  vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);
  deployFake.run = null;
});

describe("prisma-v8 service deploy", () => {
  it("deploys, promotes, and reports the resolved settings", async () => {
    const harness = await makeDeployCli({ services: [EXISTING_SERVICE] });

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
    const harness = await makeDeployCli({ services: [EXISTING_SERVICE] });

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
    const harness = await makeDeployCli({ services: [EXISTING_SERVICE] });

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
    const harness = await makeDeployCli({ services: [EXISTING_SERVICE] });

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
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
      promoted: false,
    });

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
    // The un-promoted candidate never becomes the live pointer: the
    // provider maps it back to the deployment that is still serving.
    const state = JSON.parse(
      await readFile(path.join(harness.stateDir, "state.json"), "utf8"),
    );
    expect(state.app.knownLiveDeploymentByProject.proj_1.svc_1).toBe("dep_old");
  });

  it("requires --prod for a second production deploy", async () => {
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });

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
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [],
    });

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
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });

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
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });

    const result = await harness.cli.run(deployArgs(["--prod"]), {
      cwd: harness.cwd,
      env: harness.env,
      isTty: INTERACTIVE,
      answers: ["not-the-service"],
    });

    expect(result.exitCode).toBe(2);
  });

  it("settles a non-interactive --prod run with the engine consent error", async () => {
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });

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
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });

    const result = await harness.cli.run(
      deployArgs(["--prod", "--confirm", "hello-world"]),
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ promoted: true });
  });

  it("refuses a --confirm value that is not the target service name", async () => {
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });

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
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });

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
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [LIVE_DEPLOYMENT],
    });

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
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [],
    });

    const result = await harness.cli.run(deployArgs(["--db"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(harness.calls.createdDatabases).toEqual(["db_1"]);
    expect(harness.calls.createdEnvVars).toEqual([
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
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [],
      createEnvVarFails: true,
    });

    const result = await harness.cli.run(deployArgs(["--db", "--json"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(2);
    expect(harness.calls.deletedDatabases).toEqual(["db_1"]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe(
      "SERVICE.BRANCH_DATABASE_SETUP_FAILED",
    );
  });

  it("refuses --db together with a provided DATABASE_URL", async () => {
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [],
    });

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
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [],
      envVars: [
        {
          id: "env_1",
          key: "DATABASE_URL",
          branchId: null,
          class: "production",
          isManagedBySystem: false,
        },
      ],
    });

    const result = await harness.cli.run(deployArgs(["--db"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(harness.calls.createdDatabases).toEqual([]);
    expect(result.presented?.data).toMatchObject({
      branchDatabase: {
        status: "skipped",
        reason: "production-env-exists",
      },
    });
  });

  it("updates an existing branch DIRECT_URL instead of adding a second one", async () => {
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [],
      branchRole: "preview",
      databaseDirectUrl: true,
      envVars: [
        {
          id: "env_direct",
          key: "DIRECT_URL",
          branchId: "br_1",
          class: "preview",
          isManagedBySystem: false,
        },
      ],
    });

    const result = await harness.cli.run(deployArgs(["--db"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(harness.calls.createdEnvVars).toEqual([
      { key: "DATABASE_URL", className: "preview" },
    ]);
    expect(harness.calls.updatedEnvVars).toEqual(["env_direct"]);
    expect(result.presented?.data).toMatchObject({
      branchDatabase: { envVars: ["DATABASE_URL", "DIRECT_URL"] },
    });
  });

  it("removes a stale branch DIRECT_URL when the new database has no direct endpoint", async () => {
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [],
      branchRole: "preview",
      envVars: [
        {
          id: "env_direct",
          key: "DIRECT_URL",
          branchId: "br_1",
          class: "preview",
          isManagedBySystem: false,
        },
      ],
    });

    const result = await harness.cli.run(deployArgs(["--db"]), {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(harness.calls.deletedEnvVars).toEqual(["env_direct"]);
    expect(result.presented?.data).toMatchObject({
      branchDatabase: { envVars: ["DATABASE_URL"] },
    });
  });

  it("reports a build-phase failure as SERVICE.BUILD_FAILED with the standalone-output hint", async () => {
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deploy: (progress) => {
        progress?.onBuildStart?.();
        throw new Error("Next.js requires standalone output for this build");
      },
    });

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
    expect(editAction?.label).toContain(
      'Add output: "standalone" to next.config.*',
    );
  });

  it("reports a post-build failure with the deployment id and a logs action", async () => {
    const harness = await makeDeployCli({
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
    const harness = await makeDeployCli({ services: [EXISTING_SERVICE] });

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
    const harness = await makeDeployCli({ services: [EXISTING_SERVICE] });

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
    const harness = await makeDeployCli({ services: [] });

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
    expect(harness.calls.createdProjects).toEqual(["brand-new"]);
    expect(harness.calls.createdServices).toEqual(["hello-world"]);
    expect(result.presented?.data).toMatchObject({
      localPin: { path: ".prisma/local.json", written: true },
    });
    const pin = JSON.parse(
      await readFile(path.join(harness.cwd, ".prisma/local.json"), "utf8"),
    );
    expect(pin.projectId).toBe("proj_new");
  });

  it("reports a failed local binding through the operation layer's own error", async () => {
    const harness = await makeDeployCli({ services: [] });
    // A file where the .prisma directory belongs: the pin write fails at
    // its first step.
    await writeFile(path.join(harness.cwd, ".prisma"), "", "utf8");

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
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.LOCAL_STATE_WRITE_FAILED");
    expect(frame.envelope.error.summary).toBe(
      "Could not save local Project binding",
    );
    // The mapper distinguishes the pin write from the .gitignore update and
    // says which step failed; a stringified error object says neither.
    expect(frame.envelope.error.why).toBe(
      "The CLI could not write .prisma/local.json.",
    );
    expect(frame.envelope.error.meta).toMatchObject({
      pinPath: ".prisma/local.json",
      operation: "create-directory",
    });
    expect(frame.envelope.error.nextActions).toContainEqual({
      kind: "run-command",
      label: "Run",
      command: "prisma-cli service deploy --project <id-or-name>",
    });
  });

  it("rejects an unsupported --framework value at parse time", async () => {
    const harness = await makeDeployCli({ services: [EXISTING_SERVICE] });

    const result = await harness.cli.run(
      ["service", "deploy", "--project", "acme-app", "--framework", "django"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      authenticated: false,
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
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [],
    });
    await writeMultiTargetConfig(harness.cwd);

    const result = await harness.cli.run(
      ["service", "deploy", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
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
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      tone: "ok",
      text: "Deployed 2 services.",
    });
  });

  it("rejects per-service inputs when deploying every target", async () => {
    const harness = await makeDeployCli({
      services: [EXISTING_SERVICE],
      deployments: [],
    });
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
    const harness = await makeDeployCli({
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
