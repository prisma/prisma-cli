/**
 * Statement flags: `--<verb>` followed by the verb's `arity` values,
 * repeatable, accepted only by the command that declares the verb. The
 * engine takes them out of argv before the parser sees it, because the
 * parser gives a flag one value per occurrence and keeps no order
 * across flags. The values stay out of the handler's flags; the
 * handler reads them through ctx.prompt.statement or
 * ctx.statements.take.
 */
import { camelCase } from "../args";
import type { AnyCommand, StatementSpec } from "../commands";
import { CliStructuredError } from "../protocol";
import type { CommandTreeEntry, CommandTreeNode } from "./command-tree";

export type DeclaredStatements = Readonly<Record<string, StatementSpec>>;

export function statementsOf(def: AnyCommand): DeclaredStatements {
  return def.kind === "result-command" ? (def.statements ?? {}) : {};
}

export function declaredStatements(def: AnyCommand): readonly string[] {
  return Object.keys(statementsOf(def));
}

/** How help shows the flag: `<subject>` for the first value, `<value>`
 *  for each further one. */
export function statementPlaceholders(spec: StatementSpec): string {
  return [
    "<subject>",
    ...Array.from({ length: spec.arity - 1 }, () => "<value>"),
  ].join(" ");
}

export function statementBrief(verb: string, spec: StatementSpec): string {
  return (
    spec.brief ??
    `Say what happens to <subject>: ${verb}, instead of being asked (repeatable)`
  );
}

export interface StatementFlagValue {
  readonly verb: string;
  /** The `arity` values the flag was given, in order. */
  readonly values: readonly string[];
  consumed: boolean;
}

/** The command argv routes to, found the way the parser routes: the
 *  leading words, group by group, until one names a command. Like the
 *  parser, a kebab-case word matches a camelCase name. */
export function routedCommand(
  tree: CommandTreeNode,
  argv: readonly string[],
): CommandTreeEntry | undefined {
  let node = tree;
  for (const token of argv) {
    const entry =
      node.commands.get(token) ?? node.commands.get(camelCase(token));
    if (entry !== undefined) {
      return entry;
    }
    const child =
      node.children.get(token) ?? node.children.get(camelCase(token));
    if (child === undefined) {
      return undefined;
    }
    node = child;
  }
  return undefined;
}

function statementFlagIn(
  token: string,
  statements: DeclaredStatements,
): { readonly verb: string; readonly inline: string | undefined } | undefined {
  if (!token.startsWith("--")) {
    return undefined;
  }
  const equals = token.indexOf("=");
  const verb = token.slice(2, equals === -1 ? undefined : equals);
  if (!Object.hasOwn(statements, verb)) {
    return undefined;
  }
  return { verb, inline: equals === -1 ? undefined : token.slice(equals + 1) };
}

/** A first value that starts with `-` reads as a flag, so it can only
 *  be given inline; the error says so when that is what happened. */
function wrongValueCount(
  verb: string,
  arity: number,
  given: number,
  next: string | undefined,
): CliStructuredError {
  const wanted = arity === 1 ? "a value" : `${arity} values`;
  const summary = `--${verb} needs ${wanted}, and was given ${given}.`;
  if (given === 0 && next?.startsWith("-") === true) {
    return new CliStructuredError(
      "CLI.INVALID_ARGUMENTS",
      `${summary} A value that starts with '-' must be written --${verb}=<value>.`,
      {
        nextActions: [
          { kind: "user-choice", label: `Write --${verb}=<value>.` },
        ],
      },
    );
  }
  return new CliStructuredError("CLI.INVALID_ARGUMENTS", summary, {
    nextActions: [
      { kind: "user-choice", label: `Pass --${verb} followed by ${wanted}.` },
    ],
  });
}

function emptyValue(verb: string): CliStructuredError {
  return new CliStructuredError(
    "CLI.INVALID_ARGUMENTS",
    `--${verb} was given an empty value.`,
    {
      nextActions: [
        { kind: "user-choice", label: `Name what --${verb} is about.` },
      ],
    },
  );
}

export type StatementExtraction =
  | {
      readonly ok: true;
      readonly argv: readonly string[];
      readonly values: StatementFlagValue[];
    }
  | { readonly ok: false; readonly error: CliStructuredError };

/**
 * Takes the command's statement flags out of argv, keeping their
 * values in the order argv gave them. A value is any following token
 * that is not a flag; nothing after a bare `--` is a flag.
 */
export function extractStatementFlags(
  argv: readonly string[],
  statements: DeclaredStatements,
): StatementExtraction {
  const terminator = argv.indexOf("--");
  const tokens = terminator === -1 ? argv : argv.slice(0, terminator);
  const rest = terminator === -1 ? [] : argv.slice(terminator);
  const kept: string[] = [];
  const values: StatementFlagValue[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    index += 1;
    const flag = statementFlagIn(token, statements);
    if (flag === undefined) {
      kept.push(token);
      continue;
    }
    const { arity } = statements[flag.verb];
    const given = flag.inline === undefined ? [] : [flag.inline];
    while (
      given.length < arity &&
      index < tokens.length &&
      !tokens[index].startsWith("-")
    ) {
      given.push(tokens[index]);
      index += 1;
    }
    if (given.length !== arity) {
      return {
        ok: false,
        error: wrongValueCount(flag.verb, arity, given.length, tokens[index]),
      };
    }
    if (given.some((value) => value.trim() === "")) {
      return { ok: false, error: emptyValue(flag.verb) };
    }
    values.push({ verb: flag.verb, values: given, consumed: false });
  }
  return { ok: true, argv: [...kept, ...rest], values };
}
