import { camelCase } from "../args";
import type { AnyCommand } from "../commands";
import { flagTokens } from "./pre-parse-argv";

/** The statement verbs a command declared; only result commands can. */
export function declaredStatements(def: AnyCommand): readonly string[] {
  return def.kind === "result-command" ? Object.keys(def.statements) : [];
}

/** The parser's view of a statement flag: repeatable, one value each,
 *  never required. */
export function statementFlagParameter(verb: string, brief?: string) {
  return {
    kind: "parsed",
    parse: (input: string) => input,
    placeholder: "subject",
    variadic: true,
    optional: true,
    brief:
      brief ??
      `Say what happens to <subject>: ${verb}, instead of being asked (repeatable)`,
  } as const;
}

export interface StatementFlagValue {
  readonly verb: string;
  readonly text: string;
  consumed: boolean;
}

function verbFlagIn(
  token: string,
  verbs: readonly string[],
): string | undefined {
  if (!token.startsWith("--")) {
    return undefined;
  }
  const equals = token.indexOf("=");
  if (equals === token.length - 1) {
    return undefined;
  }
  const name = camelCase(token.slice(2, equals === -1 ? undefined : equals));
  return verbs.includes(name) ? name : undefined;
}

function parsedValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Every statement-flag value, in the order argv gave them. The parser
 * groups values by flag, so argv decides only which verb comes next;
 * the values themselves are the parser's. A parsed value argv could
 * not place is appended rather than dropped, so it is still reported
 * if nothing consumes it.
 */
export function statementFlagValues(
  argv: readonly string[],
  verbs: readonly string[],
  parsedFlags: Readonly<Record<string, unknown>>,
): StatementFlagValue[] {
  const remaining = new Map(
    verbs.map((verb) => [verb, parsedValues(parsedFlags[verb])]),
  );
  const ordered: StatementFlagValue[] = [];
  for (const token of flagTokens(argv)) {
    const verb = verbFlagIn(token, verbs);
    const text = verb === undefined ? undefined : remaining.get(verb)?.shift();
    if (verb !== undefined && text !== undefined) {
      ordered.push({ verb, text, consumed: false });
    }
  }
  for (const [verb, texts] of remaining) {
    for (const text of texts) {
      ordered.push({ verb, text, consumed: false });
    }
  }
  return ordered;
}
