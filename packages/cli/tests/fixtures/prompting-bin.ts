// A bin that prompts once through the real process adapter, for the
// pseudo-terminal exit test. Prints the run's exit code once the engine
// has settled, so the driver can tell "settled but still alive" from
// "never settled".
import { type Block, createCli, defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { assembleRuntime } from "../../src/runtime";

const probe = defineCommand({
  help: { summary: "Prompt probe" },
  handler: async (_args, ctx) => {
    const answer = await ctx.prompt.confirm("Proceed?", { default: true });
    return ok(
      ctx.present(
        { data: { answer } },
        {
          human: (): readonly Block[] => [
            { kind: "summary", status: "ok", text: `answer=${answer}` },
          ],
          stdout: () => [],
          json: () => ({ answer }),
          next: () => [],
        },
      ),
    );
  },
});

const cli = createCli({
  name: "probe",
  version: "0.0.0",
  commandFamilies: [],
  groups: {},
  commands: { probe },
});
const runtime = await assembleRuntime(process);
const exitCode = await cli.run(["probe"], runtime);
process.stderr.write(`[settled ${exitCode}]\n`);
process.exitCode = exitCode;
