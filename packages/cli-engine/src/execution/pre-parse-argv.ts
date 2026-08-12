/**
 * What the engine must decide from raw argv before stricli parses it:
 * the format its own failure output is framed in, whether `--version`
 * was asked for, and the one malformed `--config` shape the parser
 * cannot see.
 *
 * They share a correctness rule, which is why they share a module.
 * Everything after a bare `--` is a positional and never a flag, so
 * every scan stops there — expressed once, in `flagTokens`, rather
 * than re-implemented in each scan.
 */
import type { Format } from "../presentation";

function flagTokens(argv: readonly string[]): readonly string[] {
  const terminator = argv.indexOf("--");
  return terminator === -1 ? argv : argv.slice(0, terminator);
}

export function versionFlagGiven(argv: readonly string[]): boolean {
  return flagTokens(argv).includes("--version");
}

/**
 * The one malformed `--config` shape the parser cannot see. stricli
 * matches a flag-with-value against `/^--([a-z][a-z-.\d_]+)=(.+)$/`,
 * which needs at least one character after the `=`, so the bare token
 * `--config=` is not a flag to it at all and falls through to the
 * command's positional arguments. prisma/prisma rejects that shape as a
 * usage error (a user who wrote `--config=` meant to name a file), so
 * the engine checks for the exact token before handing argv over.
 *
 * Running before parsing, this cannot tell a flag from data: it rejects
 * `--config=` wherever it appears ahead of a bare `--`, including as
 * another flag's value or a positional. prisma/prisma's scan does the
 * same and does not stop at `--`; the token is an odd one to need as
 * data, and `--` remains the way to pass it.
 */
export function configFlagGivenNoValue(argv: readonly string[]): boolean {
  return flagTokens(argv).includes("--config=");
}

/** The format requested by --json / --format / --format=<value>, if
 *  any. */
export function formatFlagGiven(argv: readonly string[]): Format | undefined {
  const tokens = flagTokens(argv);
  for (const [index, token] of tokens.entries()) {
    if (token === "--json" || token === "--format=json") {
      return "json";
    }
    if (token === "--format=human") {
      return "human";
    }
    if (token === "--format") {
      const value = tokens[index + 1];
      if (value === "json" || value === "human") {
        return value;
      }
    }
  }
  return undefined;
}
