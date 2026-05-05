import { Command, Option } from "commander";

export interface GlobalFlags {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  trace: boolean;
  yes: boolean;
  interactive: boolean | undefined;
  color: boolean | undefined;
}

export function addGlobalFlags(command: Command): Command {
  return command
    .option("--json", "Emit structured JSON output.")
    .option("-q, --quiet", "Reduce human-oriented output.")
    .option("-v, --verbose", "Increase human-oriented output detail.")
    .option("--trace", "Show deeper diagnostics for failures.")
    .option("-y, --yes", "Accept supported confirmation prompts.")
    .addOption(new Option("--interactive", "Force interactive behavior when prompts are supported."))
    .addOption(new Option("--no-interactive", "Disable interactive behavior and prompts."))
    .addOption(new Option("--color", "Force color output in supported terminals."))
    .addOption(new Option("--no-color", "Disable color output."));
}

function getExplicitBoolean(argv: string[], positive: string, negative: string): boolean | undefined {
  for (let index = argv.length - 1; index >= 0; index -= 1) {
    const value = argv[index];
    if (value === positive) {
      return true;
    }
    if (value === negative) {
      return false;
    }
  }

  return undefined;
}

export function resolveGlobalFlags(argv: string[], options: Record<string, unknown>): GlobalFlags {
  return {
    // Fall back to raw argv scan: Commander v12 can swallow a flag at the parent command
    // level when both parent and child define the same option name.
    json: options.json === true || argv.includes("--json"),
    quiet: options.quiet === true || argv.includes("--quiet") || argv.includes("-q"),
    verbose: options.verbose === true || argv.includes("--verbose") || argv.includes("-v"),
    trace: options.trace === true || argv.includes("--trace"),
    yes: options.yes === true || argv.includes("--yes") || argv.includes("-y"),
    interactive: getExplicitBoolean(argv, "--interactive", "--no-interactive"),
    color: getExplicitBoolean(argv, "--color", "--no-color"),
  };
}
