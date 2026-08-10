import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StreamRecord } from "@prisma/compute-sdk";
import { CancelledError, streamLogs } from "@prisma/compute-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAuthState } from "../src/auth";
import {
  DEPLOYMENTS,
  makeServiceCli,
  page,
  readFlowRoutes,
  SERVICE,
  SIGNED_IN,
} from "./v8-service-testkit";

vi.mock("../src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth")>()),
  readAuthState: vi.fn(),
}));

vi.mock("@prisma/compute-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prisma/compute-sdk")>()),
  streamLogs: vi.fn(),
}));

/** The shape `streamLogs` resolves to; only isErr/error are read. */
function streamOk() {
  return { isErr: () => false } as never;
}

function streamErr(error: unknown) {
  return { isErr: () => true, error } as never;
}

/** Drives the record callback, then closes the stream cleanly. */
function emits(records: StreamRecord[]) {
  return vi
    .fn()
    .mockImplementation(
      (_options: unknown, onRecord: (record: StreamRecord) => void) => {
        for (const record of records) {
          onRecord(record);
        }
        return Promise.resolve(streamOk());
      },
    );
}

function logRecord(text: string): StreamRecord {
  return { type: "log", text, byteStart: 0, byteEnd: text.length };
}

function outputs(events: readonly { kind: string }[]) {
  return events
    .filter((event) => event.kind === "output")
    .map((event) => {
      const output = event as unknown as { channel: string; line: string };
      return { channel: output.channel, line: output.line };
    });
}

function outputData(events: readonly { kind: string }[]) {
  return events
    .filter((event) => event.kind === "output")
    .map((event) => (event as unknown as { data?: unknown }).data);
}

const TARGET = ["--project", "acme-app", "--service", "hello-world"];

beforeEach(() => {
  vi.mocked(readAuthState).mockReset();
  vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);
  vi.mocked(streamLogs).mockReset();
});

describe("prisma-v8 service logs", () => {
  it("streams the live deployment, header on stderr and log text on stdout", async () => {
    vi.mocked(streamLogs).mockImplementation(
      emits([logRecord("listening on :3000\n"), logRecord("request ok")]),
    );
    const harness = await makeServiceCli({ rawTokenSeed: true });

    const result = await harness.cli.run(["service", "logs", ...TARGET], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(outputs(result.events)).toEqual([
      { channel: "diagnostic", line: "project: proj_1" },
      { channel: "diagnostic", line: "service: hello-world" },
      { channel: "diagnostic", line: "deployment: dep_2" },
      { channel: "data", line: "listening on :3000" },
      { channel: "data", line: "request ok" },
    ]);
  });

  it("routes log text to stdout and the header to stderr in human mode", async () => {
    vi.mocked(streamLogs).mockImplementation(emits([logRecord("hello")]));
    const harness = await makeServiceCli({ rawTokenSeed: true });

    const result = await harness.cli.run(
      ["service", "logs", ...TARGET, "--format", "human"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toContain("deployment: dep_2");
  });

  it("surfaces a terminal record that is not the normal end", async () => {
    vi.mocked(streamLogs).mockImplementation(
      emits([
        {
          type: "terminal",
          kind: "error",
          code: "stream_lost",
          message: "The log stream ended unexpectedly.",
          retryable: true,
          cursor: null,
        },
      ]),
    );
    const harness = await makeServiceCli({ rawTokenSeed: true });

    const result = await harness.cli.run(["service", "logs", ...TARGET], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(outputs(result.events)).toContainEqual({
      channel: "diagnostic",
      line: "The log stream ended unexpectedly.",
    });
  });

  it("frames every record in json mode and terminates with one result frame", async () => {
    vi.mocked(streamLogs).mockImplementation(
      emits([logRecord("one"), logRecord("two")]),
    );
    const harness = await makeServiceCli({ rawTokenSeed: true });

    const result = await harness.cli.run(
      ["service", "logs", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.json.map((frame) => frame.kind)).toEqual([
      "output",
      "output",
      "output",
      "output",
      "output",
      "result",
    ]);
    const last = result.json[result.json.length - 1];
    if (last?.kind !== "result" || !last.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(last.envelope.commandId).toBe("service.logs");
  });

  it("streams an explicit --deployment of the named service", async () => {
    vi.mocked(streamLogs).mockImplementation(emits([logRecord("older")]));
    const harness = await makeServiceCli({ rawTokenSeed: true });

    const result = await harness.cli.run(
      ["service", "logs", ...TARGET, "--deployment", "dep_1"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(outputs(result.events)).toContainEqual({
      channel: "diagnostic",
      line: "deployment: dep_1",
    });
    expect(vi.mocked(streamLogs).mock.calls[0]?.[0]).toMatchObject({
      deploymentId: "dep_1",
    });
  });

  it("carries each log record's byte range in the event data", async () => {
    vi.mocked(streamLogs).mockImplementation(emits([logRecord("hello")]));
    const harness = await makeServiceCli({ rawTokenSeed: true });

    const result = await harness.cli.run(["service", "logs", ...TARGET], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    // The three header lines carry no data; the log record carries its own.
    expect(outputData(result.events)).toEqual([
      undefined,
      undefined,
      undefined,
      { byteStart: 0, byteEnd: 5 },
    ]);
  });

  it("carries a reported terminal record's cursor, code and retryable", async () => {
    vi.mocked(streamLogs).mockImplementation(
      emits([
        {
          type: "terminal",
          kind: "error",
          code: "stream_lost",
          message: "The log stream ended unexpectedly.",
          retryable: true,
          cursor: "77",
        },
      ]),
    );
    const harness = await makeServiceCli({ rawTokenSeed: true });

    const result = await harness.cli.run(["service", "logs", ...TARGET], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(outputData(result.events).at(-1)).toEqual({
      cursor: "77",
      code: "stream_lost",
      retryable: true,
    });
  });

  it("scopes --deployment to the service named by the compute config", async () => {
    vi.mocked(streamLogs).mockImplementation(emits([logRecord("sibling")]));
    const sibling = { ...SERVICE, id: "svc_2", name: "sidecar" };
    const siblingDeployment = {
      id: "dep_9",
      status: "running",
      createdAt: "2026-08-03T00:00:00.000Z",
      previewDomain: "dep9.prisma.app",
    };
    const harness = await makeServiceCli({
      rawTokenSeed: true,
      routes: readFlowRoutes({
        "GET /v1/apps": () => ({ data: page([SERVICE, sibling]) }),
        "GET /v1/apps/{appId}/deployments": (init) => ({
          data: page(
            init.params?.path?.appId === "svc_2"
              ? [siblingDeployment]
              : DEPLOYMENTS,
          ),
        }),
        "GET /v1/deployments/{deploymentId}": (init) =>
          init.params?.path?.deploymentId === "dep_9"
            ? { data: { data: siblingDeployment } }
            : { error: { error: { message: "not found" } }, status: 404 },
      }),
    });
    // The config is what scopes this run: without it the id resolves
    // globally and streams the sibling's logs, which is what legacy
    // refused by folding the config name in before the lookup.
    await writeFile(
      path.join(harness.cwd, "prisma.compute.json"),
      JSON.stringify({ app: { name: "hello-world", framework: "hono" } }),
    );

    const result = await harness.cli.run(
      [
        "service",
        "logs",
        "--project",
        "acme-app",
        "--deployment",
        "dep_9",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
    expect(frame.envelope.error.summary).toContain(
      'not found for service "hello-world"',
    );
    expect(streamLogs).not.toHaveBeenCalled();
  });

  it("reports a compute config naming a service the project does not have", async () => {
    vi.mocked(streamLogs).mockImplementation(emits([logRecord("ignored")]));
    const harness = await makeServiceCli({ rawTokenSeed: true });
    await writeFile(
      path.join(harness.cwd, "prisma.compute.json"),
      JSON.stringify({ app: { name: "retired", framework: "hono" } }),
    );

    const result = await harness.cli.run(
      [
        "service",
        "logs",
        "--project",
        "acme-app",
        "--deployment",
        "dep_1",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.SELECTION_INVALID");
    expect(streamLogs).not.toHaveBeenCalled();
  });

  it("resolves a bare --deployment globally when no compute config names a service", async () => {
    vi.mocked(streamLogs).mockImplementation(emits([logRecord("older")]));
    const harness = await makeServiceCli({ rawTokenSeed: true });

    // No answers are scripted, so reaching the service picker would fail
    // the run: this is what proves the global lookup never prompts.
    const result = await harness.cli.run(
      ["service", "logs", "--project", "acme-app", "--deployment", "dep_1"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(outputs(result.events)).toContainEqual({
      channel: "diagnostic",
      line: "service: hello-world",
    });
    expect(vi.mocked(streamLogs).mock.calls[0]?.[0]).toMatchObject({
      deploymentId: "dep_1",
    });
  });

  it("rejects a --deployment that does not belong to the named service", async () => {
    const harness = await makeServiceCli({ rawTokenSeed: true });

    const result = await harness.cli.run(
      ["service", "logs", ...TARGET, "--deployment", "dep_other", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
    expect(frame.envelope.error.summary).toContain(
      'not found for service "hello-world"',
    );
  });

  it("rejects an unknown --deployment id when no service is named", async () => {
    const harness = await makeServiceCli({
      rawTokenSeed: true,
      routes: readFlowRoutes({
        "GET /v1/deployments/{deploymentId}": () => ({
          error: { error: { message: "not found" } },
          status: 404,
        }),
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "logs",
        "--project",
        "acme-app",
        "--deployment",
        "dep_missing",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
    expect(frame.envelope.error.summary).toBe(
      'Deployment "dep_missing" not found',
    );
  });

  it("rejects a deployment whose service cannot be resolved", async () => {
    const harness = await makeServiceCli({
      rawTokenSeed: true,
      routes: readFlowRoutes({
        // The deployment resolves, but the global scan (which lists by
        // project, without a branch) finds no service that owns it.
        "GET /v1/apps": (init) =>
          init.params?.query?.branchGitName === undefined
            ? { data: page([]) }
            : { data: page([SERVICE]) },
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "logs",
        "--project",
        "acme-app",
        "--deployment",
        "dep_2",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
    expect(frame.envelope.error.summary).toContain(
      "is not attached to a service",
    );
  });

  it("rejects a deployment that belongs to another project", async () => {
    const foreignService = {
      ...SERVICE,
      id: "svc_foreign",
      name: "foreign",
      branchId: "br_2",
    };
    const harness = await makeServiceCli({
      rawTokenSeed: true,
      routes: readFlowRoutes({
        // Resolvable globally through the foreign service, absent from the
        // services the resolved project/branch lists.
        "GET /v1/apps": (init) =>
          init.params?.query?.branchGitName === undefined
            ? { data: page([foreignService]) }
            : { data: page([]) },
        "GET /v1/apps/{appId}": () => ({
          data: {
            data: {
              id: "svc_foreign",
              name: "foreign",
              projectId: "proj_1",
              region: { id: null },
              latestDeploymentId: "dep_2",
              appEndpointDomain: null,
            },
          },
        }),
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "logs",
        "--project",
        "acme-app",
        "--deployment",
        "dep_2",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
    expect(frame.envelope.error.summary).toContain("in the resolved project");
  });

  it("reports SERVICE.NO_DEPLOYMENTS when the project has no service", async () => {
    const harness = await makeServiceCli({
      rawTokenSeed: true,
      routes: readFlowRoutes({ "GET /v1/apps": () => ({ data: page([]) }) }),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.NO_DEPLOYMENTS");
  });

  it("reports SERVICE.NO_DEPLOYMENTS when the service has no deployments", async () => {
    const harness = await makeServiceCli({
      rawTokenSeed: true,
      routes: readFlowRoutes({
        "GET /v1/apps": () => ({
          data: page([{ ...SERVICE, latestDeploymentId: null }]),
        }),
        "GET /v1/apps/{appId}": () => ({
          data: {
            data: {
              id: "svc_1",
              name: "hello-world",
              projectId: "proj_1",
              region: { id: "eu-central-1" },
              latestDeploymentId: null,
              appEndpointDomain: null,
            },
          },
        }),
        "GET /v1/apps/{appId}/deployments": () => ({ data: page([]) }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "logs", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.NO_DEPLOYMENTS");
  });

  it("settles a stream failure as SERVICE.DEPLOY_FAILED", async () => {
    vi.mocked(streamLogs).mockResolvedValue(
      streamErr(new Error("socket hung up")),
    );
    const harness = await makeServiceCli({ rawTokenSeed: true });

    const result = await harness.cli.run(
      ["service", "logs", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
    expect(frame.envelope.error.summary).toBe("Failed to stream service logs");
  });

  it("treats a cancelled stream as a clean shutdown", async () => {
    vi.mocked(streamLogs).mockResolvedValue(streamErr(new CancelledError()));
    const harness = await makeServiceCli({ rawTokenSeed: true });

    const result = await harness.cli.run(["service", "logs", ...TARGET], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
  });

  it("caches the selected service", async () => {
    vi.mocked(streamLogs).mockImplementation(emits([]));
    const harness = await makeServiceCli({ rawTokenSeed: true });

    await harness.cli.run(["service", "logs", ...TARGET], {
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
  });

  it("reports the missing raw token when credentials come from the credential manager", async () => {
    // ESCALATED: the log stream authenticates itself and needs a raw
    // token. Seeding a credential manager and no raw token models the
    // runtime that arrives with the auth rework: once `auth login`
    // writes a credential-manager session instead of the legacy
    // `{tokens: […]}` file, ctx.getCredentials() resolves nothing for a
    // signed-in user and the command cannot stream. Recorded in the
    // divergence file.
    vi.mocked(streamLogs).mockImplementation(emits([]));
    const harness = await makeServiceCli();

    const result = await harness.cli.run(
      ["service", "logs", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe(
      "SERVICE.LOG_STREAM_CREDENTIALS_UNAVAILABLE",
    );
    expect(streamLogs).not.toHaveBeenCalled();
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({ authenticated: false });

    const result = await harness.cli.run(["service", "logs", ...TARGET], {
      cwd: harness.cwd,
      env: harness.env,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
    expect(streamLogs).not.toHaveBeenCalled();
  });
});
