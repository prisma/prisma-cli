import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  page,
  type RawService,
  readFlowRoutes,
  SERVICE,
} from "./service-testkit";

function blocks(presented: unknown) {
  const value = presented as
    | { presentation: { human: Array<{ kind: string }> } }
    | undefined;
  return value?.presentation.human ?? [];
}

/** A second service on the branch, never promoted: it carries an
 *  endpoint domain but names no live deployment. */
const UNDEPLOYED: RawService = {
  id: "svc_2",
  name: "worker",
  region: { id: "us-east-1" },
  branchId: "br_1",
  latestDeploymentId: null,
  appEndpointDomain: "worker.prisma.app",
};

function listRoutes(services: RawService[] = [SERVICE, UNDEPLOYED]) {
  return readFlowRoutes({
    "GET /v1/apps": () => ({ data: page(services) }),
  });
}

describe("prisma service list", () => {
  it("lists the project's services with the live url of each", async () => {
    const harness = await makeServiceCli({ routes: listRoutes() });

    const result = await harness.cli.run(
      ["service", "list", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    // A listing reports: it runs no steps and streams nothing.
    expect(result.events).toEqual([]);
    expect(result.presented?.data).toEqual({
      projectId: "proj_1",
      projectName: "acme-app",
      branch: "main",
      services: [
        {
          id: "svc_1",
          name: "hello-world",
          region: "eu-central-1",
          liveVersionId: "dep_2",
          liveUrl: "https://hello.prisma.app",
        },
        {
          id: "svc_2",
          name: "worker",
          region: "us-east-1",
          liveVersionId: null,
          liveUrl: null,
        },
      ],
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "table"),
    ).toEqual({
      kind: "table",
      columns: ["name", "id", "region", "live url"],
      rows: [
        ["hello-world", "svc_1", "eu-central-1", "https://hello.prisma.app"],
        ["worker", "svc_2", "us-east-1", "not deployed"],
      ],
    });
    // stdout carries the values, not the table's "not deployed" wording.
    expect(result.presented?.presentation.stdout).toEqual([
      "hello-world\tsvc_1\teu-central-1\thttps://hello.prisma.app",
      "worker\tsvc_2\tus-east-1\t",
    ]);
  });

  it("presents no live url for a service that was never promoted", async () => {
    const harness = await makeServiceCli({ routes: listRoutes([UNDEPLOYED]) });

    const result = await harness.cli.run(
      ["service", "list", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    // The service carries "worker.prisma.app" on its record, and that
    // domain does not resolve until the first promote.
    expect(result.presented?.data).toMatchObject({
      services: [{ id: "svc_2", liveUrl: null }],
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "table"),
    ).toMatchObject({
      rows: [["worker", "svc_2", "us-east-1", "not deployed"]],
    });
  });

  it("treats a project with no services as a success that offers create", async () => {
    const harness = await makeServiceCli({ routes: listRoutes([]) });

    const result = await harness.cli.run(
      ["service", "list", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      projectId: "proj_1",
      projectName: "acme-app",
      branch: "main",
      services: [],
    });
    expect(blocks(result.presented)).toContainEqual({
      kind: "summary",
      status: "info",
      text: "No services found.",
    });
    // Advice, not a run-command: a consumer executes `command` verbatim,
    // and `service create <name>` would name a service "<name>".
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "user-choice",
        label:
          "Create a service with service create <name>, choosing the name.",
      },
    ]);
  });

  it("scopes the listing to the requested branch", async () => {
    const branches: string[] = [];
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/apps": (init) => {
          branches.push(init.params?.query?.branchGitName as string);
          return { data: page([SERVICE]) };
        },
      }),
    });

    const result = await harness.cli.run(
      ["service", "list", "--project", "acme-app", "--branch", "staging"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(branches).toEqual(["staging"]);
    expect(result.presented?.data).toMatchObject({ branch: "staging" });
  });

  it("emits the completed json envelope with commandId service.list", async () => {
    const harness = await makeServiceCli({ routes: listRoutes() });

    const result = await harness.cli.run(
      ["service", "list", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.list");
    expect(frame.envelope.result).toMatchObject({
      services: [{ id: "svc_1" }, { id: "svc_2" }],
    });
  });

  it("settles an unknown project as SERVICE.PROJECT_NOT_FOUND with exit 2", async () => {
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/apps": () => ({
          error: { error: { message: "Resource Not Found" } },
          status: 404,
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "list", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.PROJECT_NOT_FOUND");
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      routes: listRoutes(),
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "list", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
