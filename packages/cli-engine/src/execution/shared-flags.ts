import type { Severity } from "../events";
import type { Format } from "../presentation";
import type { Runtime } from "../runtime";
import type { RunState } from "./engine";

/** The engine-injected shared flag family. Commands cannot declare
 *  these names or aliases; handlers never see their values. */
export const RESERVED_FLAG_NAMES: ReadonlySet<string> = new Set([
  "format",
  "json",
  "logLevel",
  "verbose",
  "quiet",
  "yes",
  "confirm",
  "interactive",
  "color",
  "help",
  "helpAll",
  "version",
]);

export const RESERVED_ALIASES: ReadonlySet<string> = new Set([
  "v",
  "q",
  "y",
  "h",
]);

export const SHARED_FLAG_PARAMETERS = {
  format: {
    kind: "enum",
    values: ["human", "json"],
    optional: true,
    brief: "Output format",
  },
  json: {
    kind: "boolean",
    default: false,
    brief: "Shorthand for --format json",
  },
  logLevel: {
    kind: "enum",
    values: ["error", "warn", "info", "verbose"],
    optional: true,
    brief: "Commentary verbosity",
  },
  verbose: {
    kind: "boolean",
    default: false,
    brief: "Shorthand for --log-level verbose",
  },
  quiet: {
    kind: "boolean",
    default: false,
    brief: "Shorthand for --log-level error",
  },
  yes: {
    kind: "boolean",
    default: false,
    brief: "Accept prompt defaults without asking",
  },
  confirm: {
    kind: "parsed",
    parse: (input: string) => input,
    placeholder: "value",
    variadic: true,
    optional: true,
    brief:
      "Grant a consent prompt non-interactively by typing its token (repeatable)",
  },
  interactive: {
    kind: "boolean",
    optional: true,
    withNegated: true,
    brief: "Force interactive prompts on or off",
  },
  color: {
    kind: "boolean",
    optional: true,
    withNegated: true,
    brief: "Force ANSI color on or off",
  },
} as const;

export const SHARED_ALIASES = { v: "verbose", q: "quiet", y: "yes" } as const;

export interface SharedFlags {
  readonly format?: Format;
  readonly json?: boolean;
  readonly logLevel?: Severity;
  readonly verbose?: boolean;
  readonly quiet?: boolean;
  readonly yes?: boolean;
  readonly confirm?: readonly string[];
  readonly interactive?: boolean;
  readonly color?: boolean;
}

/** The pre-parse format decision: json framing must be in effect before
 *  stricli parses (its own failure output is framed too), so the format
 *  flags are scanned from raw argv. */
export function sniffFormat(argv: readonly string[], runtime: Runtime): Format {
  return explicitFormat(argv) ?? (runtime.isTty.stdout ? "human" : "json");
}

/** The format requested by --json / --format / --format=<value>, if
 *  any. Arguments after a bare `--` are positionals, never flags. */
function explicitFormat(argv: readonly string[]): Format | undefined {
  for (const [index, argument] of argv.entries()) {
    if (argument === "--") {
      return undefined;
    }
    if (argument === "--json" || argument === "--format=json") {
      return "json";
    }
    if (argument === "--format=human") {
      return "human";
    }
    if (argument === "--format") {
      const value = argv[index + 1];
      if (value === "json" || value === "human") {
        return value;
      }
    }
  }
  return undefined;
}

export function applySharedFlags(
  state: RunState,
  shared: SharedFlags,
  runtime: Runtime,
): void {
  state.format = shared.format ?? resolveAutoFormat(shared, runtime);
  state.yes = shared.yes === true;
  state.confirmValues = [...(shared.confirm ?? [])];
  state.interactive = shared.interactive ?? defaultInteractive(runtime);
  state.logLevel = resolveLogLevel(shared);
  state.colorEnabled =
    shared.color ??
    (runtime.isTty.stdout && runtime.env.NO_COLOR === undefined);
}

/** Interactive iff TTY stdin outside CI; --interactive and
 *  --no-interactive override in either direction. Format never decides
 *  interactivity (operator ruling, 2026-08-09): an interactive json run
 *  may prompt — the prompt UI writes to stderr, so stdout stays a clean
 *  frame stream. */
export function defaultInteractive(runtime: Runtime): boolean {
  return runtime.isTty.stdin && runtime.env.CI === undefined;
}

function resolveAutoFormat(shared: SharedFlags, runtime: Runtime): Format {
  if (shared.json === true) {
    return "json";
  }
  return runtime.isTty.stdout ? "human" : "json";
}

/** --quiet and --verbose are log-level shorthands; either one beats an
 *  explicit --log-level given alongside it. */
function resolveLogLevel(shared: SharedFlags): Severity {
  if (shared.quiet === true) {
    return "error";
  }
  if (shared.verbose === true) {
    return "verbose";
  }
  return shared.logLevel ?? "info";
}
