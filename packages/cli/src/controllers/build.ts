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

export async function runBuildLogs(
  context: CommandContext,
  buildId: string,
  options: BuildLogsOptions = {},
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

  const { data, response } = await client.GET("/v1/builds/{buildId}/logs", {
    params: {
      path: { buildId },
      query: {
        ...(options.follow ? { follow: "true" as const } : {}),
        ...(options.cursor ? { cursor: options.cursor } : {}),
      },
    },
    parseAs: "stream",
    signal: context.runtime.signal,
  });

  const body = data as ReadableStream<Uint8Array> | null | undefined;
  if (!response.ok || !body) {
    throw buildLogsRequestError(buildId, response.status);
  }

  let sawError = false;
  await forEachNdjsonRecord<BuildLogRecord>(body, (record) => {
    if (record.type === "terminal" && record.kind === "error") {
      sawError = true;
    }
    writeBuildLogRecord(context, record);
  });

  if (sawError) {
    process.exitCode = 1;
  }
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

function buildLogsRequestError(buildId: string, status: number): CliError {
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
    why: `The Management API returned HTTP ${status}.`,
    fix: "Retry the command, or rerun with --trace for more detail.",
    exitCode: 1,
  });
}
