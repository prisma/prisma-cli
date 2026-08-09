import type { Cli } from "@prisma/cli-engine";
import { buildCli } from "./cli";
import { assembleRuntime, type HostProcess } from "./runtime";

/** The bin body: build, run, return the exit code. Signal policy lives
 *  in the engine; the bin only forwards signals and provides
 *  process.exit. A construction error prints one line to stderr and
 *  exits 1. */
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
  const runtime = await assembleRuntime(proc);
  return cli.run(proc.argv.slice(2), runtime);
}
