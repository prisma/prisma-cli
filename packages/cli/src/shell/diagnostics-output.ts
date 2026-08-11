import { shortenHomePath } from "../lib/fs/home-path";

import type { CommandDiagnostics } from "../types/diagnostics";
import type { CommandContext } from "./runtime";
import { renderVerboseBlock, type VerboseRow } from "./ui";

export function renderCommandDiagnostics(
  context: CommandContext,
  diagnostics: CommandDiagnostics | undefined,
  rows: VerboseRow[] = [],
  options: { title?: string } = {},
): string[] {
  if (!diagnostics) {
    return [];
  }

  const { env } = context.runtime;
  const git = diagnostics.git;

  return renderVerboseBlock(
    context.ui,
    [
      ...rows,
      ...(diagnostics.durationMs === undefined
        ? []
        : [{ key: "duration", value: formatDuration(diagnostics.durationMs) }]),
      { key: "cwd", value: formatLocalPath(diagnostics.cwd, env) },
      {
        key: "state file",
        value: formatLocalPath(diagnostics.stateFilePath, env),
      },
      ...(git
        ? [
            {
              key: "git ref",
              value: git.ref ?? "detached",
              tone: git.ref ? ("default" as const) : ("dim" as const),
            },
            {
              key: "git sha",
              value: git.sha ?? "unknown",
              tone: git.sha ? ("default" as const) : ("dim" as const),
            },
            {
              key: "git dirty",
              value: formatDirtyState(git.dirty),
              tone: git.dirty ? ("warning" as const) : ("dim" as const),
            },
          ]
        : [{ key: "git", value: "not detected", tone: "dim" as const }]),
    ],
    { title: options.title ?? "Local context" },
  );
}

export function formatLocalPath(value: string, env: NodeJS.ProcessEnv): string {
  return shortenHomePath(value, env);
}

function formatDirtyState(dirty: boolean | null): string {
  if (dirty === null) {
    return "unknown";
  }

  return dirty ? "yes" : "no";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}
