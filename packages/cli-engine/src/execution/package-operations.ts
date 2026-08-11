import {
  installCommand,
  type PackageManagerCommand,
  type PackageManagerId,
  type PackageManagerRunResult,
  type PackageOperations,
  resolvePackageManager,
  runCommand,
} from "../package-manager";
import { packageManagerFailedError } from "../package-manager-errors";
import { type CliStructuredError, notOk, ok, type Result } from "../protocol";
import type { Invocation } from "./engine";
import { redactSecrets } from "./redaction";
import { reportEvent } from "./reporting";

/** What the seam reports for a child that never ran, and what a host
 *  with no runner at all reports for the same reason. */
const NO_CHILD_EXIT_CODE = 1;

type Operation =
  | {
      readonly form: "install";
      readonly packages: readonly string[];
      readonly dev: boolean;
    }
  | {
      readonly form: "run";
      readonly package: string;
      readonly args: readonly string[];
    };

interface Placement {
  readonly cwd?: string;
  readonly manager?: PackageManagerId;
}

type OperationResult = Result<{ readonly command: string }, CliStructuredError>;

function spell(
  operation: Operation,
  manager: PackageManagerId,
): PackageManagerCommand {
  return operation.form === "install"
    ? installCommand(manager, {
        packages: operation.packages,
        dev: operation.dev,
      })
    : runCommand(manager, { package: operation.package, args: operation.args });
}

function failed(
  operation: Operation,
  command: PackageManagerCommand,
  outcome: {
    readonly manager: PackageManagerId;
    readonly exitCode: number;
    readonly stderrTail: string;
    readonly reason?: "runner-unavailable";
  },
): CliStructuredError {
  const spellings = {
    command: redactSecrets(command.line),
    runnableCommand: command.line,
  };
  return packageManagerFailedError(
    operation.form === "install"
      ? { ...outcome, ...spellings, form: "install" }
      : {
          ...outcome,
          ...spellings,
          form: "run",
          package: operation.package,
        },
  );
}

/** The seam hands over chunks as the child writes them; an `output`
 *  event carries one line, so a line split across two chunks waits for
 *  its second half. */
function lineAssembler(emit: (line: string) => void): {
  readonly push: (chunk: string) => void;
  readonly flush: () => void;
} {
  let pending = "";
  const emitLine = (line: string): void => {
    emit(redactSecrets(line.endsWith("\r") ? line.slice(0, -1) : line));
  };
  return {
    push: (chunk) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        emitLine(line);
      }
    },
    flush: () => {
      if (pending !== "") {
        emitLine(pending);
        pending = "";
      }
    },
  };
}

function outputChannels(
  invocation: Invocation,
  manager: PackageManagerId,
): {
  readonly push: (channel: "data" | "diagnostic", chunk: string) => void;
  readonly flush: () => void;
} {
  const assemble = (channel: "data" | "diagnostic") =>
    lineAssembler((line) => {
      reportEvent(invocation, {
        kind: "output",
        source: manager,
        channel,
        line,
      });
    });
  const channels = {
    data: assemble("data"),
    diagnostic: assemble("diagnostic"),
  };
  return {
    push: (channel, chunk) => {
      channels[channel].push(chunk);
    },
    flush: () => {
      channels.data.flush();
      channels.diagnostic.flush();
    },
  };
}

async function execute(
  invocation: Invocation,
  operation: Operation,
  placement: Placement,
): Promise<OperationResult> {
  const { runtime, signal } = invocation;
  const cwd = placement.cwd ?? runtime.cwd;
  const manager = await resolvePackageManager({
    cwd,
    env: runtime.env,
    override: placement.manager,
    host: runtime.packageManager,
  });
  const command = spell(operation, manager);
  const runner = runtime.runPackageManager;
  if (runner === undefined) {
    return notOk(
      failed(operation, command, {
        manager,
        exitCode: NO_CHILD_EXIT_CODE,
        stderrTail: "",
        reason: "runner-unavailable",
      }),
    );
  }
  const output = outputChannels(invocation, manager);
  const step = redactSecrets(command.line);
  reportEvent(invocation, { kind: "step-started", step });
  let result: PackageManagerRunResult;
  try {
    result = await runner({
      file: command.file,
      args: command.args,
      cwd,
      signal,
      onOutput: output.push,
    });
  } finally {
    output.flush();
  }
  if (signal.aborted) {
    throw signal.reason;
  }
  reportEvent(invocation, {
    kind: "step-finished",
    step,
    outcome: result.exitCode === 0 ? "ok" : "failed",
  });
  if (result.exitCode === 0) {
    return ok({ command: command.line });
  }
  return notOk(
    failed(operation, command, {
      manager,
      exitCode: result.exitCode,
      stderrTail: redactSecrets(result.stderr),
    }),
  );
}

export function makePackageOperations(
  invocation: Invocation,
): PackageOperations {
  let running = false;
  /** The claim is taken before the first await, so a caller that fires
   *  a second operation without awaiting the first still hits it. */
  const perform = async (
    operation: Operation,
    placement: Placement,
  ): Promise<OperationResult> => {
    if (running) {
      throw new Error(
        "@prisma/cli-engine: ctx.packages runs one operation at a time, so two package managers can never write one project at once",
      );
    }
    running = true;
    try {
      return await execute(invocation, operation, placement);
    } finally {
      running = false;
    }
  };

  return {
    install: (request) =>
      perform(
        {
          form: "install",
          packages: request.packages,
          dev: request.dev ?? false,
        },
        request,
      ),
    run: (request) =>
      perform(
        { form: "run", package: request.package, args: request.args },
        request,
      ),
  };
}
