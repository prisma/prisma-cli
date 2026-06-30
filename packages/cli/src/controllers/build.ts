import { requireComputeAuth } from "../lib/auth/guard";
import { authRequiredError, CliError } from "../shell/errors";
import { writeJsonEvent } from "../shell/output";
import type { CommandContext } from "../shell/runtime";

/**
 * One line of `GET /v1/builds/{buildId}/logs` (the `BuildLogNdjsonLine` schema).
 * Build logs are a separate system from runtime `app logs`: this stream is keyed
 * by `Build.id` (a git-push / Console build), not a compute version.
 */
type BuildLogRecord =
  | {
      type: "log";
      text: string;
      level: "info" | "error";
      source: "runner" | "stdout" | "stderr";
      step?: string;
      cursor: string;
    }
  | {
      type: "terminal";
      kind: "end" | "error";
      code: string;
      message: string;
      retryable: boolean;
      cursor: string | null;
    };

export interface BuildLogsOptions {
  follow?: boolean;
  cursor?: string;
}

/**
 * Backoff between retry attempts. The length also bounds the retry budget: with
 * two delays the stream is opened at most three times. Injectable so tests can
 * exercise the retry paths without real timers.
 */
const RETRY_BACKOFF_MS: readonly number[] = [500, 1500];

const TRANSIENT_OPEN_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

type TerminalRecord = Extract<BuildLogRecord, { type: "terminal" }>;

type BuildLogsClient = NonNullable<
  Awaited<ReturnType<typeof requireComputeAuth>>
>;

interface BuildLogsDeps {
  backoffMs?: readonly number[];
}

type ReadOutcome =
  | { kind: "done" }
  | { kind: "auth" }
  | { kind: "not-found" }
  | { kind: "fatal"; status: number }
  | { kind: "retryable-open"; status: number }
  | { kind: "retryable-network" }
  | { kind: "retryable-terminal"; record: TerminalRecord };

export async function runBuildLogs(
  context: CommandContext,
  buildId: string,
  options: BuildLogsOptions = {},
  deps: BuildLogsDeps = {},
): Promise<void> {
  const client = await requireComputeAuth(
    context.runtime.env,
    context.runtime.signal,
  );
  if (!client) {
    throw authRequiredError(["prisma-cli auth login"]);
  }

  if (!context.flags.json && !context.flags.quiet) {
    context.output.stderr.write(
      `build logs → Streaming logs for build ${buildId}\n\n`,
    );
  }

  const backoffMs = deps.backoffMs ?? RETRY_BACKOFF_MS;
  const signal = context.runtime.signal;
  // Resume from the last cursor we saw so a reconnect doesn't reprint logs.
  let cursor = options.cursor;

  for (let attempt = 0; ; attempt++) {
    // biome-ignore lint/performance/noAwaitInLoops: retries are sequential — each attempt resumes from the prior cursor.
    const result = await readBuildLogs(
      context,
      client,
      buildId,
      options,
      cursor,
    );
    cursor = result.cursor;
    const { outcome } = result;

    if (outcome.kind === "done") {
      return;
    }

    const immediate = immediateStatus(outcome);
    if (immediate !== null) {
      throw buildLogsRequestError(buildId, immediate);
    }

    if (attempt >= backoffMs.length) {
      surfaceExhaustedRetry(context, buildId, outcome);
      return;
    }

    if (!(await backoffBeforeRetry(backoffMs[attempt], signal))) {
      return;
    }
  }
}

/**
 * HTTP status to surface immediately (no retry), or null when the outcome is a
 * retryable failure the loop should back off and re-attempt.
 */
function immediateStatus(outcome: ReadOutcome): number | null {
  switch (outcome.kind) {
    case "auth":
      return 401;
    case "not-found":
      return 404;
    case "fatal":
      return outcome.status;
    default:
      return null;
  }
}

function surfaceExhaustedRetry(
  context: CommandContext,
  buildId: string,
  outcome: ReadOutcome,
): void {
  if (outcome.kind === "retryable-terminal") {
    writeBuildLogRecord(context, outcome.record);
    process.exitCode = 1;
    return;
  }
  throw buildLogsRequestError(
    buildId,
    outcome.kind === "retryable-open" ? outcome.status : 0,
  );
}

/** Waits the backoff, returning false if the wait was canceled by an abort. */
async function backoffBeforeRetry(
  ms: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }
  try {
    await sleep(ms, signal);
    return true;
  } catch {
    return false;
  }
}

async function readBuildLogs(
  context: CommandContext,
  client: BuildLogsClient,
  buildId: string,
  options: BuildLogsOptions,
  cursor: string | undefined,
): Promise<{ outcome: ReadOutcome; cursor: string | undefined }> {
  const opened = await openBuildLogStream(
    context,
    client,
    buildId,
    options,
    cursor,
  );
  if (opened.kind !== "ok") {
    return { outcome: opened, cursor };
  }
  return consumeBuildLogStream(context, opened.body, cursor);
}

type OpenOutcome =
  | { kind: "ok"; body: ReadableStream<Uint8Array> }
  | Exclude<ReadOutcome, { kind: "done" | "retryable-terminal" }>;

async function openBuildLogStream(
  context: CommandContext,
  client: BuildLogsClient,
  buildId: string,
  options: BuildLogsOptions,
  cursor: string | undefined,
): Promise<OpenOutcome> {
  try {
    const { data, response } = await client.GET("/v1/builds/{buildId}/logs", {
      params: {
        path: { buildId },
        query: {
          ...(options.follow ? { follow: "true" as const } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
      parseAs: "stream",
      signal: context.runtime.signal,
    });
    const body = data as ReadableStream<Uint8Array> | null | undefined;
    if (response.ok && body) {
      return { kind: "ok", body };
    }
    return openFailureOutcome(response.status);
  } catch (error) {
    if (isAbortError(error) || context.runtime.signal.aborted) {
      throw error;
    }
    return { kind: "retryable-network" };
  }
}

function openFailureOutcome(
  status: number,
): Exclude<ReadOutcome, { kind: "done" | "retryable-terminal" }> {
  if (status === 401) {
    return { kind: "auth" };
  }
  if (status === 404) {
    return { kind: "not-found" };
  }
  if (TRANSIENT_OPEN_STATUSES.has(status)) {
    return { kind: "retryable-open", status };
  }
  return { kind: "fatal", status };
}

async function consumeBuildLogStream(
  context: CommandContext,
  body: ReadableStream<Uint8Array>,
  cursor: string | undefined,
): Promise<{ outcome: ReadOutcome; cursor: string | undefined }> {
  let latestCursor = cursor;
  let retryableTerminal: TerminalRecord | null = null;
  try {
    await forEachNdjsonRecord<BuildLogRecord>(body, (record) => {
      if (record.cursor) {
        latestCursor = record.cursor;
      }
      if (
        record.type === "terminal" &&
        record.kind === "error" &&
        record.retryable
      ) {
        retryableTerminal = record;
        return;
      }
      writeBuildLogRecord(context, record);
    });
  } catch (error) {
    if (isAbortError(error) || context.runtime.signal.aborted) {
      throw error;
    }
    return { outcome: { kind: "retryable-network" }, cursor: latestCursor };
  }

  if (retryableTerminal) {
    return {
      outcome: { kind: "retryable-terminal", record: retryableTerminal },
      cursor: latestCursor,
    };
  }
  return { outcome: { kind: "done" }, cursor: latestCursor };
}

function writeBuildLogRecord(
  context: CommandContext,
  record: BuildLogRecord,
): void {
  if (context.flags.json) {
    writeJsonEvent(context.output, {
      type: record.type,
      command: "build.logs",
      timestamp: new Date().toISOString(),
      data: record,
    });
    return;
  }

  if (record.type === "log") {
    const stream =
      record.source === "stderr" || record.level === "error"
        ? context.output.stderr
        : context.output.stdout;
    stream.write(record.text);
    if (!record.text.endsWith("\n")) {
      stream.write("\n");
    }
    return;
  }

  // A terminal `end` is the normal stream close — nothing to print. A `no_logs`
  // end or any error terminal carries a message the user should see.
  if (record.code !== "end") {
    context.output.stderr.write(`${record.message}\n`);
  }
}

/** Reads a newline-delimited JSON body line by line, parsing each into a record. */
async function forEachNdjsonRecord<T>(
  body: ReadableStream<Uint8Array>,
  onRecord: (record: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: a stream must be read sequentially, chunk by chunk.
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        onRecord(JSON.parse(line) as T);
      }
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      const tail = buffer.trim();
      if (tail) {
        onRecord(JSON.parse(tail) as T);
      }
      return;
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function buildLogsRequestError(buildId: string, status: number): CliError {
  if (status === 401) {
    return authRequiredError(["prisma-cli auth login"]);
  }
  if (status === 404) {
    return new CliError({
      code: "BUILD_NOT_FOUND",
      domain: "app",
      summary: `Build ${buildId} was not found`,
      why: "The build does not exist, or your workspace does not have access to it.",
      fix: "Check the build id, or run prisma-cli auth login to switch to the workspace that owns it.",
      exitCode: 1,
    });
  }
  return new CliError({
    code: "BUILD_LOGS_FAILED",
    domain: "app",
    summary: `Failed to read logs for build ${buildId}`,
    why:
      status > 0
        ? `The Management API returned HTTP ${status}.`
        : "The log stream could not be read after several attempts.",
    fix: "Retry the command, or rerun with --trace for more detail.",
    exitCode: 1,
  });
}
