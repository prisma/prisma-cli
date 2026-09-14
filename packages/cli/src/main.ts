import type { Cli } from "@prisma/cli-engine";
import { buildCli } from "./cli";
import { assembleRuntime, type HostProcess } from "./runtime";
import { maybeWriteSkillsStaleNotice } from "./skills-check";
import { maybeWriteCachedUpdateNotification } from "./update-check";

/** The bin body: build, run, return the exit code. Signal policy lives
 *  in the engine; the bin only forwards signals and provides
 *  process.exit. A construction error prints one line to stderr and
 *  exits 1. Telemetry is the engine's: it decides and composes at
 *  command start, and the runtime's spawnTelemetry seam forks the
 *  sender. */
export async function main(
  proc: HostProcess,
  buildCliForRun: () => Cli = buildCli,
): Promise<number> {
  let cli: Cli;
  try {
    cli = buildCliForRun();
  } catch (cause) {
    proc.stderr.write(
      `${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 1;
  }
  // Legacy sequencing: the cached update notification (and its detached
  // refresh spawn) runs before the command dispatches, so the notice
  // precedes all command output on stderr.
  await maybeWriteCachedUpdateNotification({
    env: proc.env,
    argv: proc.argv.slice(2),
    stderr: proc.stderr,
  });
  const runtime = await assembleRuntime(proc);
  const exitCode = await cli.run(proc.argv.slice(2), runtime);
  // After the command, so the notice does not push its output down, and
  // without touching the exit code: the skills being stale is not a
  // failure of the command that reported it. It lives here rather than
  // in the engine because every mounted family dispatches through this
  // one call, so one check covers all of them.
  await maybeWriteSkillsStaleNotice({
    env: proc.env,
    argv: proc.argv.slice(2),
    cwd: proc.cwd(),
    stderr: proc.stderr,
  });
  return exitCode;
}
