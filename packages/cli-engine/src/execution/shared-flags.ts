import type { Severity } from "../events";
import type { Format } from "../presentation";
import { CliStructuredError } from "../protocol";
import type { Runtime } from "../runtime";
import type { RunState } from "./engine";
import { formatFlagGiven } from "./pre-parse-argv";

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
  "config",
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
  config: {
    kind: "parsed",
    parse: parseConfigPath,
    placeholder: "path",
    optional: true,
    brief: "Read this config file instead of ./prisma.config.ts",
  },
} as const;

/** Rejects `--config ""`, which a shell produces from
 *  `--config "$UNSET_VAR"`. prisma/prisma treats the empty value as a
 *  usage error rather than letting it reach the loader as an empty
 *  path, and so does this: the parser turns the throw into the run's
 *  usage error. */
function parseConfigPath(input: string): string {
  if (input === "") {
    throw new Error("--config needs a path, and was given an empty value");
  }
  return input;
}

export function configFlagGivenNoValueError(): CliStructuredError {
  return new CliStructuredError(
    "CLI.INVALID_ARGUMENTS",
    "--config needs a path, and was given an empty value",
    {
      why: "`--config=` binds the flag to an empty value.",
      nextActions: [
        {
          kind: "user-choice",
          label: "Pass a config path: --config <path> or --config=<path>.",
        },
      ],
    },
  );
}

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
  readonly config?: string;
}

/** The pre-parse format decision: json framing must be in effect before
 *  stricli parses (its own failure output is framed too), so the format
 *  flags are read from raw argv and a TTY stdout decides the rest. */
export function sniffFormat(argv: readonly string[], runtime: Runtime): Format {
  return formatFlagGiven(argv) ?? (runtime.isTty.stdout ? "human" : "json");
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
  state.colorEnabled = resolveColorEnabled(shared, runtime);
  state.configPath = shared.config;
}

/**
 * Explicit flag, then the environment, then the stream. The stream is
 * stderr because that is where blocks render: keying off stdout meant
 * `cmd > file` lost colour a human was watching and `cmd 2> file` kept
 * colour nobody could see.
 */
function resolveColorEnabled(shared: SharedFlags, runtime: Runtime): boolean {
  if (shared.color !== undefined) {
    return shared.color;
  }
  if (runtime.env.NO_COLOR !== undefined) {
    return false;
  }
  return runtime.isTty.stderr;
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
