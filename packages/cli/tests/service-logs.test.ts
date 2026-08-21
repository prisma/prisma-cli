import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  page,
  type Routes,
  readFlowRoutes,
  SERVICE,
  SERVICE_DETAIL,
} from "./service-testkit";

type LogRecord =
  | { type: "log"; text: string; byteStart: number; byteEnd: number }
  | {
      type: "terminal";
      kind: "end" | "error";
      code: string;
      message: string;
      retryable: boolean;
      cursor: string | null;
    };

/** Chunks that ignore record boundaries: every record is cut in half and
 *  the last one carries no trailing newline, so each page drives both
 *  the reader's partial-line buffer and its end-of-stream tail. */
function ndjsonStream(records: LogRecord[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = records.flatMap((record, index) => {
    const line = JSON.stringify(record);
    const split = Math.floor(line.length / 2);
    return [
      line.slice(0, split),
      line.slice(split) + (index === records.length - 1 ? "" : "\n"),
    ];
  });
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function log(text: string, byteStart = 0): LogRecord {
  return { type: "log", text, byteStart, byteEnd: byteStart + text.length };
}

function end(cursor: string | null): LogRecord {
  return {
    type: "terminal",
    kind: "end",
    code: "end",
    message: "page complete",
    retryable: false,
    cursor,
  };
}

function errorTerminal(retryable: boolean): LogRecord {
  return {
    type: "terminal",
    kind: "error",
    code: "log_read_failed",
    message: "The log store is unavailable.",
    retryable,
    cursor: null,
  };
}

/** One page per request, in order; the last one repeats once exhausted.
 *  Every request's query is captured so a test can assert what it sent. */
function logRoutes(
  pages: LogRecord[][],
  queries: Array<Record<string, unknown> | undefined>,
  onRequest?: (index: number) => void,
): Routes {
  let index = 0;
  return readFlowRoutes({
    "GET /v1/deployments/{deploymentId}/logs": (init) => {
      queries.push(init.params?.query);
      onRequest?.(index);
      const records = pages[Math.min(index, pages.length - 1)] ?? [];
      index += 1;
      return { data: ndjsonStream(records) };
    },
  });
}

function outputs(events: readonly { kind: string }[]) {
  return events
    .filter((event) => event.kind === "output")
    .map((event) => {
      const output = event as unknown as { channel: string; line: string };
      return { channel: output.channel, line: output.line };
    });
}

function dataLines(events: readonly { kind: string }[]): string[] {
  return outputs(events)
    .filter((output) => output.channel === "data")
    .map((output) => output.line);
}

const TARGET = ["--project", "acme-app", "--service", "hello-world"];
/** Polling is instant so a follow test does not wait on the 2s default. */
const FAST_POLL = { PRISMA_CLI_SERVICE_LOGS_POLL_MS: "0" };

describe("prisma-cli service logs", () => {
  it("reads one page of the live deployment's logs and exits 0", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const harness = await makeServiceCli({
      routes: logRoutes(
        [[log("first line"), log("second line"), end("42")]],
        queries,
      ),
    });

    const result = await harness.cli.run(["service", "logs", ...TARGET], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    // The service's latest deployment is dep_2, so that is what is read.
    expect(outputs(result.events)).toContainEqual({
      channel: "diagnostic",
      line: "deployment: dep_2",
    });
    expect(dataLines(result.events)).toEqual(["first line", "second line"]);
    // One page only: no follow, so no second request.
    expect(queries).toHaveLength(1);
    // The endpoint's own default, sent explicitly.
    expect(queries[0]).toEqual({ tail: 100 });
    // The routine terminal record ends the page and is not printed.
    expect(outputs(result.events)).not.toContainEqual(
      expect.objectContaining({ line: "page complete" }),
    );
  });

  it("passes --tail through as the page size", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const harness = await makeServiceCli({
      routes: logRoutes([[log("only"), end("1")]], queries),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--tail", "500", ...TARGET],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(queries[0]).toEqual({ tail: 500 });
  });

  it("maps --from-start to from_start and sends no tail", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const harness = await makeServiceCli({
      routes: logRoutes([[log("beginning"), end("1")]], queries),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--from-start", ...TARGET],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(queries[0]).toEqual({ from_start: "true" });
  });

  it("refuses --tail together with --from-start before reading anything", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const harness = await makeServiceCli({
      routes: logRoutes([[log("never read"), end(null)]], queries),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--tail", "5", "--from-start", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.LOGS_RANGE_CONFLICT");
    // Refused before any work: the target was never resolved or read.
    expect(queries).toEqual([]);
  });

  it("reads an explicit --deployment resolved globally", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const harness = await makeServiceCli({
      routes: logRoutes([[log("from dep_1"), end("7")]], queries),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--deployment", "dep_1", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(outputs(result.events)).toContainEqual({
      channel: "diagnostic",
      line: "deployment: dep_1",
    });
    expect(dataLines(result.events)).toEqual(["from dep_1"]);
  });

  it("refuses without --service or PRISMA_SERVICE_ID as SERVICE.TARGET_REQUIRED", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([[end(null)]], []),
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
    expect(frame.envelope.error.code).toBe("SERVICE.TARGET_REQUIRED");
    expect(frame.envelope.error.summary).toContain("--service");
  });

  it("resolves --deployment within the named service", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const harness = await makeServiceCli({
      routes: logRoutes([[log("from dep_1"), end("7")]], queries),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--deployment", "dep_1", ...TARGET],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(outputs(result.events)).toContainEqual({
      channel: "diagnostic",
      line: "service: hello-world",
    });
    expect(outputs(result.events)).toContainEqual({
      channel: "diagnostic",
      line: "deployment: dep_1",
    });
    expect(dataLines(result.events)).toEqual(["from dep_1"]);
  });

  it("refuses a --deployment the named service does not own", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([[end(null)]], []),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--deployment", "dep_missing", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
    // The service-scoped refusal, not the global lookup's 404.
    expect(frame.envelope.error.summary).toContain('for service "hello-world"');
  });

  it("scopes --deployment to the PRISMA_SERVICE_ID service like --service", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([[end(null)]], []),
    });

    const result = await harness.cli.run(
      [
        "service",
        "logs",
        "--deployment",
        "dep_missing",
        "--project",
        "acme-app",
        "--json",
      ],
      {
        cwd: harness.cwd,
        env: { ...harness.env, PRISMA_SERVICE_ID: "svc_1" },
      },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
    expect(frame.envelope.error.summary).toContain('for service "hello-world"');
  });

  it("settles an unknown --deployment as SERVICE.DEPLOYMENT_NOT_FOUND", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([[end(null)]], []),
    });

    const result = await harness.cli.run(
      [
        "service",
        "logs",
        "--deployment",
        "dep_missing",
        "--project",
        "acme-app",
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
  });

  it("settles a deployment owned by another project as its own failure", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const harness = await makeServiceCli({
      routes: {
        ...logRoutes([[end(null)]], queries),
        // The deployment's owning service is found by the global scan
        // (no branch scope), but the resolved project's own listing is
        // branch-scoped and does not contain it.
        "GET /v1/apps": (init) => ({
          data: init.params?.query?.branchGitName ? page([]) : page([SERVICE]),
        }),
      },
    });

    const result = await harness.cli.run(
      [
        "service",
        "logs",
        "--deployment",
        "dep_1",
        "--project",
        "acme-app",
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
      "SERVICE.DEPLOYMENT_OUTSIDE_PROJECT",
    );
    expect(queries).toEqual([]);
  });

  it("settles a service with no live deployment as SERVICE.NO_DEPLOYMENTS", async () => {
    const harness = await makeServiceCli({
      routes: {
        ...logRoutes([[end(null)]], []),
        "GET /v1/apps": () => ({
          data: page([{ ...SERVICE, latestDeploymentId: null }]),
        }),
        "GET /v1/apps/{appId}": () => ({
          data: { data: { ...SERVICE_DETAIL, latestDeploymentId: null } },
        }),
      },
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

  it("settles an error terminal record as a structured failure", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes(
        [[log("before the failure"), errorTerminal(false)]],
        [],
      ),
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
    expect(frame.envelope.error.code).toBe("SERVICE.LOGS_FAILED");
    expect(frame.envelope.error.why).toBe("The log store is unavailable.");
    expect(frame.envelope.error.meta).toMatchObject({
      code: "log_read_failed",
      retryable: false,
    });
  });

  /**
   * A page always ends with a terminal record, so a body that stops
   * without one was cut short. Exiting 0 there would present a partial
   * log as the whole page, with nothing telling the user it was not.
   */
  it("settles a truncated page as SERVICE.LOGS_INCOMPLETE, keeping the lines it read", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([[log("arrived"), log("also arrived")]], []),
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
    expect(frame.envelope.error.code).toBe("SERVICE.LOGS_INCOMPLETE");
    // What did arrive is still reported: the refusal is about
    // completeness, not about discarding the lines that were read.
    expect(dataLines(result.events)).toEqual(["arrived", "also arrived"]);
  });

  it("settles a refused request as SERVICE.LOGS_FAILED carrying the status", async () => {
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/deployments/{deploymentId}/logs": () => ({
          error: { error: { message: "boom" } },
          status: 500,
        }),
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
    expect(frame.envelope.error.code).toBe("SERVICE.LOGS_FAILED");
    expect(frame.envelope.error.meta).toMatchObject({ status: 500 });
  });

  it("frames log lines as json stream events, carrying their byte range", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([[log("framed", 10), end("1")]], []),
    });

    const result = await harness.cli.run(
      ["service", "logs", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    // Session output is framed per record, so a json consumer reads the
    // line and the byte range it covered.
    expect(result.json).toContainEqual(
      expect.objectContaining({
        kind: "output",
        channel: "data",
        line: "framed",
        data: { byteStart: 10, byteEnd: 16 },
      }),
    );
    const last = result.json[result.json.length - 1];
    if (last?.kind !== "result" || !last.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(last.envelope.commandId).toBe("service.logs");
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([[end(null)]], []),
      authenticated: false,
    });

    const result = await harness.cli.run(["service", "logs", ...TARGET], {
      cwd: harness.cwd,
      env: harness.env,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});

describe("prisma-cli service logs --follow", () => {
  it("polls from the cursor the previous page ended on until interrupted", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const controller = new AbortController();
    const harness = await makeServiceCli({
      routes: logRoutes(
        [
          [log("page one"), end("100")],
          [log("page two"), end("200")],
        ],
        queries,
        // Interrupting from the fixture keeps the loop deterministic:
        // the run ends after exactly two pages, not after a timer.
        (index) => {
          if (index === 1) {
            controller.abort("SIGINT");
          }
        },
      ),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--follow", ...TARGET],
      {
        cwd: harness.cwd,
        env: { ...harness.env, ...FAST_POLL },
        abort: controller.signal,
      },
    );

    // The engine settles an interrupted session at 128 + SIGINT.
    expect(result.exitCode).toBe(130);
    expect(dataLines(result.events)).toEqual(["page one", "page two"]);
    // First page asks for the tail; each later page resumes from the
    // cursor the one before it ended on.
    expect(queries[0]).toEqual({ tail: 100 });
    expect(queries[1]).toEqual({ cursor: "100" });
  });

  /**
   * The retry budget is per failure, not per run: a page that succeeds
   * restores it. Without that reset the second retryable error below
   * would end the run, so this fixture is what separates "one retry per
   * failure" from "one retry ever".
   */
  it("recovers from a retryable error and can retry again later", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const controller = new AbortController();
    const harness = await makeServiceCli({
      routes: logRoutes(
        [
          [log("a"), end("100")],
          [errorTerminal(true)],
          [log("b"), end("200")],
          [errorTerminal(true)],
          [log("c"), end("300")],
        ],
        queries,
        (index) => {
          if (index === 4) {
            controller.abort("SIGINT");
          }
        },
      ),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--follow", ...TARGET],
      {
        cwd: harness.cwd,
        env: { ...harness.env, ...FAST_POLL },
        abort: controller.signal,
      },
    );

    expect(result.exitCode).toBe(130);
    expect(dataLines(result.events)).toEqual(["a", "b", "c"]);
  });

  it("stops with SERVICE.LOGS_NO_CURSOR when a page leaves nothing to resume from", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const harness = await makeServiceCli({
      // A terminal record carrying no cursor: re-requesting would fall
      // back to the default tail and reprint these same lines forever.
      routes: logRoutes([[log("only page"), end(null)]], queries),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--follow", ...TARGET, "--json"],
      { cwd: harness.cwd, env: { ...harness.env, ...FAST_POLL } },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.LOGS_NO_CURSOR");
    // The page itself was read and printed; only the follow stops.
    expect(dataLines(result.events)).toEqual(["only page"]);
    // And it stopped before asking for anything a second time.
    expect(queries).toHaveLength(1);
  });

  /** A truncated page is an incomplete read, not a page that closed with
   *  nothing to resume from, so it reports the more specific failure —
   *  the same one page mode reports for the same body. */
  it("stops with SERVICE.LOGS_INCOMPLETE when a page carries no terminal record", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const harness = await makeServiceCli({
      routes: logRoutes([[log("truncated")]], queries),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--follow", ...TARGET, "--json"],
      { cwd: harness.cwd, env: { ...harness.env, ...FAST_POLL } },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.LOGS_INCOMPLETE");
    expect(queries).toHaveLength(1);
  });

  it("retries a retryable error terminal once, then reports it", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const harness = await makeServiceCli({
      routes: logRoutes(
        [
          [log("page one"), end("100")],
          [errorTerminal(true)],
          [errorTerminal(true)],
        ],
        queries,
      ),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--follow", ...TARGET, "--json"],
      { cwd: harness.cwd, env: { ...harness.env, ...FAST_POLL } },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.LOGS_FAILED");
    // Three requests: the first page, the error, and the one retry. A
    // fourth would mean the loop was hammering a persistent failure.
    expect(queries).toHaveLength(3);
  });

  it("reports a non-retryable error terminal without retrying", async () => {
    const queries: Array<Record<string, unknown> | undefined> = [];
    const harness = await makeServiceCli({
      routes: logRoutes(
        [[log("page one"), end("100")], [errorTerminal(false)]],
        queries,
      ),
    });

    const result = await harness.cli.run(
      ["service", "logs", "--follow", ...TARGET, "--json"],
      { cwd: harness.cwd, env: { ...harness.env, ...FAST_POLL } },
    );

    expect(result.exitCode).toBe(2);
    expect(queries).toHaveLength(2);
  });
});
