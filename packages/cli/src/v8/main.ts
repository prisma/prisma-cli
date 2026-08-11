import type { Cli, CliRunHooks } from "@prisma/cli-engine";
import { maybeWriteCachedUpdateNotification } from "../update-check";
import { buildCli } from "./cli";
import { assembleRuntime, type HostProcess } from "./runtime";
import { resolveTelemetryHooks } from "./telemetry/reporting";

/** The bin body: build, run, return the exit code. Signal policy lives
 *  in the engine; the bin only forwards signals and provides
 *  process.exit. A construction error prints one line to stderr and
 *  exits 1. Telemetry: the CI/env/consent decision resolves before the
 *  run; when enabled an onSettled hook spawns the detached sender,
 *  when disabled no hook is attached — and a failure inside the
 *  telemetry layer never blocks the command. */
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
  let hooks: CliRunHooks | undefined;
  try {
    hooks = resolveTelemetryHooks(proc);
  } catch {
    hooks = undefined;
  }
  return cli.run(proc.argv.slice(2), runtime, hooks);
}
