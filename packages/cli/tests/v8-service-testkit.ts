import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  Block,
  ManagementApiClient,
  MountedTree,
  PresentedResult,
} from "@prisma/cli-engine";
import { createTestCli, mintTestJwt } from "@prisma/cli-engine/testing";
import type { AuthStateResult } from "../src/types/auth";
import { MOUNTED_COMMANDS } from "../src/v8/cli";

export const WORKSPACE = { id: "ws_1", name: "Acme Inc" };

export type SummaryBlock = Extract<Block, { kind: "summary" }>;

/**
 * The presented summary of a human-format run: the tone symbol and the
 * sentence a user reads as the command's outcome. Only materialized when
 * the run selected human format (`isTty: {stdout: true}`).
 */
export function presentedSummary(
  presented: PresentedResult<unknown> | undefined,
): SummaryBlock | undefined {
  return presented?.presentation.human.find(
    (block): block is SummaryBlock => block.kind === "summary",
  );
}

export const SIGNED_IN: AuthStateResult = {
  authenticated: true,
  provider: "github",
  user: { id: "usr_1", email: "bob@example.com", name: "Bob Example" },
  workspace: WORKSPACE,
  credential: { type: "oauth", id: null, name: null },
};

export interface RawProject {
  id: string;
  name: string;
  workspace: { id: string; name: string };
}

export interface RawService {
  id: string;
  name: string;
  region: { id: string | null };
  branchId: string | null;
  latestDeploymentId: string | null;
  appEndpointDomain: string | null;
}

export interface RawServiceDetail {
  id: string;
  name: string;
  projectId: string;
  region: { id: string | null };
  latestDeploymentId: string | null;
  appEndpointDomain: string | null;
}

export interface RawDeployment {
  id: string;
  status: string;
  createdAt: string;
  previewDomain: string | null;
}

export interface RawDomain {
  id: string;
  type: "custom-domain";
  url: string;
  hostname: string;
  appId: string;
  status: string;
  foundryStatus: string;
  failureReason: string | null;
  failureCategory: string | null;
  certExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  dnsRecords: Array<{
    type: string;
    name: string;
    value: string;
    ttl: number | null;
  }>;
}

type RouteResult =
  | { data: unknown }
  | {
      error: { error?: { message?: string; hint?: string; code?: string } };
      status: number;
    };

export type RouteHandler = (init: {
  params?: { path?: Record<string, string>; query?: Record<string, unknown> };
  body?: unknown;
}) => RouteResult;

export type Routes = Record<string, RouteHandler>;

export function page(data: unknown[]): {
  data: unknown[];
  pagination: { hasMore: false; nextCursor: null };
} {
  return { data, pagination: { hasMore: false, nextCursor: null } };
}

export function fakeManagementClient(routes: Routes): ManagementApiClient {
  const calls: Array<{ method: string; path: string; init: unknown }> = [];
  const dispatch = (method: string) => (path: string, init: unknown) => {
    calls.push({ method, path, init });
    const handler = routes[`${method} ${path}`];
    if (!handler) {
      throw new Error(`v8-service-testkit: unrouted request ${method} ${path}`);
    }
    const result = handler((init ?? {}) as Parameters<RouteHandler>[0]);
    if ("error" in result) {
      return Promise.resolve({
        data: undefined,
        error: result.error,
        response: { status: result.status, ok: false, headers: new Headers() },
      });
    }
    return Promise.resolve({
      data: result.data,
      error: undefined,
      response: { status: 200, ok: true, headers: new Headers() },
    });
  };
  const client = {
    GET: dispatch("GET"),
    POST: dispatch("POST"),
    PUT: dispatch("PUT"),
    PATCH: dispatch("PATCH"),
    DELETE: dispatch("DELETE"),
    calls,
  };
  return client as unknown as ManagementApiClient;
}

export const PROJECT: RawProject = {
  id: "proj_1",
  name: "acme-app",
  workspace: WORKSPACE,
};

export const SERVICE: RawService = {
  id: "svc_1",
  name: "hello-world",
  region: { id: "eu-central-1" },
  branchId: "br_1",
  latestDeploymentId: "dep_2",
  appEndpointDomain: "hello.prisma.app",
};

export const SERVICE_DETAIL: RawServiceDetail = {
  id: "svc_1",
  name: "hello-world",
  projectId: "proj_1",
  region: { id: "eu-central-1" },
  latestDeploymentId: "dep_2",
  appEndpointDomain: "hello.prisma.app",
};

export const DEPLOYMENTS: RawDeployment[] = [
  {
    id: "dep_1",
    status: "stopped",
    createdAt: "2026-08-01T00:00:00.000Z",
    previewDomain: "dep1.prisma.app",
  },
  {
    id: "dep_2",
    status: "running",
    createdAt: "2026-08-02T00:00:00.000Z",
    previewDomain: "dep2.prisma.app",
  },
];

export function domainRecord(overrides: Partial<RawDomain> = {}): RawDomain {
  return {
    id: "dom_1",
    type: "custom-domain",
    url: "https://shop.acme.com",
    hostname: "shop.acme.com",
    appId: "svc_1",
    status: "pending_dns",
    foundryStatus: "pending",
    failureReason: null,
    failureCategory: null,
    certExpiresAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    dnsRecords: [
      {
        type: "CNAME",
        name: "shop.acme.com",
        value: "edge.prisma.build",
        ttl: 300,
      },
    ],
    ...overrides,
  };
}

/** Routes shared by the read-flow commands: project listing, branch
 *  resolution, service listing, and deployments for SERVICE. */
export function readFlowRoutes(overrides: Routes = {}): Routes {
  return {
    "GET /v1/projects": () => ({ data: page([PROJECT]) }),
    "GET /v1/projects/{projectId}/branches": () => ({
      data: page([
        { id: "br_1", gitName: "main", isDefault: true, role: "production" },
      ]),
    }),
    "GET /v1/apps": () => ({ data: page([SERVICE]) }),
    "GET /v1/apps/{appId}": () => ({ data: { data: SERVICE_DETAIL } }),
    "GET /v1/apps/{appId}/deployments": () => ({ data: page(DEPLOYMENTS) }),
    "GET /v1/deployments/{deploymentId}": (init) => {
      const id = init.params?.path?.deploymentId;
      const found = DEPLOYMENTS.find((deployment) => deployment.id === id);
      return found
        ? { data: { data: found } }
        : { error: { error: { message: "not found" } }, status: 404 };
    },
    ...overrides,
  };
}

/**
 * Deployment routes the SDK's promote and teardown flows drive, on top
 * of the read-flow routes: a stopped deployment starts and reaches
 * "running" on the first poll, so no test waits on a poll interval.
 */
export function releaseRoutes(overrides: Routes = {}): Routes {
  const statuses = new Map([
    ["dep_1", "stopped"],
    ["dep_2", "running"],
  ]);
  return readFlowRoutes({
    "GET /v1/deployments/{deploymentId}": (init) => {
      const id = init.params?.path?.deploymentId as string;
      const status = statuses.get(id);
      if (!status) {
        return { error: { error: { message: "not found" } }, status: 404 };
      }
      return {
        data: {
          data: {
            id,
            status,
            createdAt: "2026-08-01T00:00:00.000Z",
            previewDomain: `${id}.prisma.app`,
          },
        },
      };
    },
    "POST /v1/deployments/{deploymentId}/start": (init) => {
      statuses.set(init.params?.path?.deploymentId as string, "running");
      return { data: { data: {} } };
    },
    "POST /v1/deployments/{deploymentId}/stop": (init) => {
      statuses.set(init.params?.path?.deploymentId as string, "stopped");
      return { data: { data: {} } };
    },
    "DELETE /v1/deployments/{deploymentId}": () => ({ data: { data: {} } }),
    "POST /v1/apps/{appId}/promote": () => ({
      data: { data: { appEndpointDomain: "hello.prisma.app" } },
    }),
    "DELETE /v1/apps/{appId}": () => ({ data: { data: {} } }),
    ...overrides,
  });
}

const SERVICE_GROUPS = {
  service: { brief: "Manage services and deployments for a project" },
  "service domain": { brief: "Manage custom domains for a service" },
  build: { brief: "Inspect builds created by a git push or Console" },
};

/**
 * The shipped mount map narrowed to the groups a suite exercises, so no
 * test file restates a command path that `src/v8/cli.ts` owns.
 */
export function mountedCommands(groups: readonly string[]): MountedTree {
  return Object.fromEntries(
    Object.entries(MOUNTED_COMMANDS).filter(([commandPath]) =>
      groups.some(
        (group) => commandPath === group || commandPath.startsWith(`${group} `),
      ),
    ),
  );
}

const SERVICE_COMMANDS = mountedCommands(["service", "build"]);

export interface ServiceCliOptions {
  routes?: Routes;
  authenticated?: boolean;
  /** The workspace the seeded session is signed in to; defaults to
   *  WORKSPACE. Omitting `name` seeds a session whose workspace has no
   *  name, which is what a workspace-bound service token produces. */
  sessionWorkspace?: { id: string; name?: string };
  /** The browser opener behind ctx.openUrl; pass a spy to assert what
   *  a run opened. */
  openUrl?: (url: string) => Promise<void> | void;
}

export interface ServiceCliHarness {
  cli: ReturnType<typeof createTestCli>;
  cwd: string;
  stateDir: string;
  env: Record<string, string | undefined>;
}

export async function makeServiceCli(
  options: ServiceCliOptions = {},
): Promise<ServiceCliHarness> {
  const cwd = await mkdtemp(path.join(tmpdir(), "v8-service-"));
  const stateDir = path.join(cwd, ".state");
  const env: Record<string, string | undefined> = {
    PRISMA_CLI_STATE_DIR: stateDir,
  };
  const workspace = options.sessionWorkspace ?? WORKSPACE;
  const cli = createTestCli({
    commands: SERVICE_COMMANDS,
    groups: SERVICE_GROUPS,
    // The credential manager is the shipping path for needs.credentials
    // and for the workspace every service command resolves through
    // ctx.activeCredential(); an unauthenticated harness seeds no
    // session.
    ...(options.authenticated === false
      ? {}
      : {
          sessions: [
            {
              workspaceId: workspace.id,
              workspaceName: workspace.name,
              credential: {
                token: mintTestJwt({
                  sub: "usr_1",
                  workspace_id: workspace.id,
                }),
                refreshToken: undefined,
                expiresAt: undefined,
              },
            },
          ],
          selectedWorkspaceId: workspace.id,
        }),
    managementApi: {
      client: fakeManagementClient(options.routes ?? readFlowRoutes()),
    },
    now: () => new Date(0),
    ...(options.openUrl ? { openUrl: options.openUrl } : {}),
  });
  return { cli, cwd, stateDir, env };
}
