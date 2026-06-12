import { resolveLocalStateFilePath } from "../adapters/local-state";
import { type CommandContext, resolveStateDir } from "../shell/runtime";
import type { CommandDiagnostics } from "../types/diagnostics";
import { readLocalGitState } from "./git/local-status";

export async function collectCommandDiagnostics(
  context: CommandContext,
  options: { durationMs?: number } = {},
): Promise<CommandDiagnostics> {
  const stateDir = resolveStateDir(context.runtime);

  return {
    cwd: context.runtime.cwd,
    stateFilePath: resolveLocalStateFilePath(stateDir),
    git: await readLocalGitState(context.runtime.cwd, context.runtime.signal),
    durationMs: options.durationMs,
  };
}
