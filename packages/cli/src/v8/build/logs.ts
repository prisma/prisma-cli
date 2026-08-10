import type { CommandContext } from "@prisma/cli-engine";
import { defineSessionCommand, flag, positional } from "@prisma/cli-engine";
import { CliStructuredError, okVoid } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";

/**
 * One line of `GET /v1/builds/{buildId}/logs` (the `BuildLogNdjsonLine`
 * schema). Build logs are a separate system from `service logs`: this
 * stream is keyed by Build.id (a git-push / Console build), not a
 * deployment id.
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

function buildNotFoundError(buildId: string): CliStructuredError {
  return new CliStructuredError(
    "BUILD.NOT_FOUND",
    `Build ${buildId} was not found`,
    {
      why: "The build does not exist, or your workspace does not have access to it.",
      nextActions: [
        {
          kind: "user-choice",
          label: "Check the build id, or switch to the workspace that owns it.",
        },
        {
          kind: "run-command",
          label: "Switch workspace",
          command: `${CLI_NAME} auth workspace use <id-or-name>`,
        },
      ],
    },
  );
}

function buildLogsFailedError(
  buildId: string,
  status: number,
): CliStructuredError {
  return new CliStructuredError(
    "BUILD.LOGS_FAILED",
    `Failed to read logs for build ${buildId}`,
    {
      why: `The Management API returned HTTP ${status}.`,
      meta: { status },
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Retry the command, or rerun with --log-level verbose for more detail.",
        },
      ],
    },
  );
}

/**
 * A terminal `error` record means the build itself failed. Legacy set
 * `process.exitCode = 1` and still exited the stream normally; the
 * engine has no way for a session command to settle a non-zero exit
 * from a record (sessions carry no exit-code set, and documented exit
 * codes are 4-99), so the failure is reported as an errored settlement.
 * ESCALATED — see the divergence file; this is the one line to change
 * when the engine gains a stream termination status.
 */
function buildFailedError(
  buildId: string,
  record: Extract<BuildLogRecord, { type: "terminal" }>,
): CliStructuredError {
  return new CliStructuredError("BUILD.FAILED", `Build ${buildId} failed`, {
    why: record.message,
    meta: {
      code: record.code,
      retryable: record.retryable,
      ...(record.cursor === null ? {} : { cursor: record.cursor }),
    },
    nextActions: [
      ...(record.cursor
        ? [
            {
              kind: "run-command" as const,
              label: "Resume the log stream",
              command: `${CLI_NAME} build logs ${buildId} --cursor ${record.cursor}`,
            },
          ]
        : []),
    ],
  });
}

/** Reads a newline-delimited JSON body line by line. */
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

function reportRecord(
  ctx: Pick<CommandContext, "report">,
  record: BuildLogRecord,
): void {
  if (record.type === "log") {
    ctx.report({
      kind: "output",
      source: "build",
      channel:
        record.source === "stderr" || record.level === "error"
          ? "diagnostic"
          : "data",
      line: record.text.replace(/\n$/, ""),
      ...(record.step === undefined ? {} : { data: { step: record.step } }),
    });
    return;
  }

  // A terminal `end` is the normal stream close — nothing to show. A
  // `no_logs` end, or any error terminal, carries a message the user
  // should see.
  if (record.code !== "end") {
    ctx.report({
      kind: "output",
      source: "build",
      channel: "diagnostic",
      line: record.message,
    });
  }
}

export const buildLogsCommand = defineSessionCommand({
  help: {
    summary: "Stream logs for a build",
    examples: [
      "build logs bld_123",
      "build logs bld_123 --follow",
      "build logs bld_123 --cursor 4096",
    ],
  },
  args: {
    flags: {
      follow: flag.boolean({
        brief: "Keep the connection open while the build is running",
      }),
      cursor: flag.string({
        brief: "Resume from a cursor a previous run reported",
        placeholder: "cursor",
      }),
    },
    positionals: {
      buildId: positional.string({
        brief: "Build id (from a git push or Console)",
        placeholder: "buildId",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const buildId = args.positionals.buildId;
    ctx.report({
      kind: "output",
      source: "build",
      channel: "diagnostic",
      line: `Streaming logs for build ${buildId}`,
    });

    const { data, response } = await ctx.api.GET("/v1/builds/{buildId}/logs", {
      params: {
        path: { buildId },
        query: {
          ...(args.flags.follow ? { follow: "true" as const } : {}),
          ...(args.flags.cursor ? { cursor: args.flags.cursor } : {}),
        },
      },
      parseAs: "stream",
      signal: ctx.signal,
    });

    const body = data as ReadableStream<Uint8Array> | null | undefined;
    if (!response.ok || !body) {
      throw response.status === 404
        ? buildNotFoundError(buildId)
        : buildLogsFailedError(buildId, response.status);
    }

    let failure: Extract<BuildLogRecord, { type: "terminal" }> | null = null;
    await forEachNdjsonRecord<BuildLogRecord>(body, (record) => {
      if (record.type === "terminal" && record.kind === "error") {
        failure = record;
      }
      reportRecord(ctx, record);
    });

    if (failure !== null) {
      throw buildFailedError(buildId, failure);
    }
    return okVoid();
  },
});
