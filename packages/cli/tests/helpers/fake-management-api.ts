/**
 * A real HTTP server standing in for the management API.
 *
 * This replaces the fixture mode the CLI used to carry in `src`. The
 * difference matters: fixture mode was a second implementation *inside*
 * the product, selected at runtime, so a test exercising it proved
 * nothing about the code users run. Here the CLI runs its ordinary
 * code — the same client, the same request pipeline, the same response
 * parsing — and only the far end of the socket is ours.
 *
 * Ids are the shapes the API really returns, `wksp_`-prefixed workspace
 * ids included. A fixture tidier than the API is how `project list`
 * came to report "No projects found." for a workspace holding fifteen.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_WORKSPACE_ID = "cmjs0z06102rz2mgzk5zqj495";
export const FAKE_WORKSPACE_API_ID = `wksp_${FAKE_WORKSPACE_ID}`;

export interface FakeProject {
  readonly id: string;
  readonly name: string;
  readonly slug?: string;
  readonly url?: string;
}

export interface FakeManagementApi {
  readonly baseUrl: string;
  /** Every path the CLI asked for, in order. */
  readonly requests: readonly string[];
  close: () => Promise<void>;
}

export interface FakeManagementApiOptions {
  readonly projects?: readonly FakeProject[];
  /** Extra routes, keyed by `"<METHOD> <pathname>"`. Returning
   *  `undefined` falls through to the built-in routes. */
  readonly routes?: Record<string, () => unknown>;
}

const DEFAULT_PROJECTS: readonly FakeProject[] = [
  { id: "proj_123", name: "Acme Dashboard", slug: "acme-dashboard" },
  { id: "proj_456", name: "Billing API", slug: "billing-api" },
];

export async function startFakeManagementApi(
  options: FakeManagementApiOptions = {},
): Promise<FakeManagementApi> {
  const projects = options.projects ?? DEFAULT_PROJECTS;
  const requests: string[] = [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = `${req.method} ${url.pathname}`;
    requests.push(route);

    const custom = options.routes?.[route];
    const body = custom?.() ?? builtInRoute(route, url, projects);

    res.setHeader("Content-Type", "application/json");
    if (body === undefined) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: `no route ${route}` } }));
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function builtInRoute(
  route: string,
  url: URL,
  projects: readonly FakeProject[],
): unknown {
  // What the CLI asks before it trusts a credential.
  if (route === "GET /v1/me") {
    return {
      data: {
        user: { id: "usr_456", email: "dev@example.com", name: "Dev" },
        workspace: { id: FAKE_WORKSPACE_API_ID, name: "Acme Inc" },
        credential: { type: "service_token", id: "tok_1", name: "e2e" },
      },
    };
  }

  if (route === "GET /v1/projects") {
    return {
      data: projects.map((project) => ({
        ...project,
        workspace: { id: FAKE_WORKSPACE_API_ID, name: "Acme Inc" },
      })),
    };
  }

  const project = projects.find(
    (candidate) => url.pathname === `/v1/projects/${candidate.id}`,
  );
  if (project && route.startsWith("GET ")) {
    return {
      data: {
        ...project,
        workspace: { id: FAKE_WORKSPACE_API_ID, name: "Acme Inc" },
      },
    };
  }

  if (url.pathname === `/v1/workspaces/${FAKE_WORKSPACE_ID}`) {
    return { data: { id: FAKE_WORKSPACE_API_ID, name: "Acme Inc" } };
  }

  return undefined;
}
