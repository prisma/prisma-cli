// biome-ignore-all lint/performance/useTopLevelRegex: The dotenv key scan keeps its regexes next to the code that uses them.
/** Reads the KEY=VALUE input of `prisma project variable add` and `update`:
 *  one positional assignment, or every assignment in a dotenv file. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { parse as parseDotenv } from "dotenv";

export interface VariableAssignment {
  readonly key: string;
  readonly value: string;
}

type WriteCommand = "add" | "update";

const KEY_SHAPE = /^[A-Z_][A-Z0-9_]*$/;
const MAX_KEY_LENGTH = 256;

function usageError(
  summary: string,
  why: string,
  fix: string,
  command?: string,
): CliStructuredError {
  return new CliStructuredError("VARIABLE.USAGE_ERROR", summary, {
    why,
    nextActions: [
      { kind: "user-choice", label: fix },
      ...(command === undefined
        ? []
        : [{ kind: "run-command" as const, label: command, command }]),
    ],
  });
}

/** Returns why `key` is not a valid variable key, or null when it is. */
function invalidKeyReason(key: string): string | null {
  if (key.length === 0) {
    return "The key is empty.";
  }
  if (key.length > MAX_KEY_LENGTH) {
    return `The key is longer than ${MAX_KEY_LENGTH} characters.`;
  }
  if (/^[0-9]/.test(key)) {
    return "The key starts with a digit. Keys start with an uppercase letter or an underscore.";
  }
  if (!KEY_SHAPE.test(key)) {
    return "Keys contain only uppercase letters, digits, and underscores, and start with a letter or an underscore.";
  }
  return null;
}

function validateKey(key: string, command: WriteCommand): void {
  const reason = invalidKeyReason(key);
  if (reason !== null) {
    throw usageError(
      `Variable key "${key}" is not valid`,
      reason,
      "Use a key such as STRIPE_KEY.",
      `prisma project variable ${command} STRIPE_KEY=value --group production`,
    );
  }
}

/** Parses `KEY=VALUE`, or `KEY` alone to read the value from `env`. */
export function parseAssignment(
  raw: string | undefined,
  command: WriteCommand,
  env: Readonly<Record<string, string | undefined>>,
): VariableAssignment {
  if (raw === undefined || raw.length === 0) {
    throw usageError(
      `prisma project variable ${command} requires KEY=VALUE or --file`,
      "No variable was given.",
      "Pass the variable as KEY=VALUE, or a dotenv file with --file.",
      `prisma project variable ${command} STRIPE_KEY=sk_test_xxx --group production`,
    );
  }

  const separatorIndex = raw.indexOf("=");
  if (separatorIndex === -1) {
    validateKey(raw, command);
    const value = env[raw];
    if (value === undefined || value.length === 0) {
      throw usageError(
        `No value for "${raw}"`,
        `Only the key was given, and ${raw} is not set in the current environment.`,
        "Pass KEY=VALUE, or set the variable in your shell first.",
        `prisma project variable ${command} ${raw}=value --group production`,
      );
    }
    return { key: raw, value };
  }

  const key = raw.slice(0, separatorIndex);
  const value = raw.slice(separatorIndex + 1);
  validateKey(key, command);
  if (value.length === 0) {
    throw usageError(
      `"${key}" has an empty value`,
      "Nothing follows the = sign.",
      "Pass a value, or use prisma project variable delete to remove the variable.",
    );
  }
  return { key, value };
}

/** Reads every KEY=VALUE assignment from a dotenv file, in file order. */
export async function readDotenvFile(
  cwd: string,
  filePath: string,
  command: WriteCommand,
): Promise<VariableAssignment[]> {
  let contents: string;
  try {
    contents = await readFile(path.resolve(cwd, filePath), "utf8");
  } catch (error) {
    throw usageError(
      `Could not read "${filePath}"`,
      error instanceof Error ? error.message : "The file could not be read.",
      "Pass the path of a readable dotenv file.",
      `prisma project variable ${command} --file .env --group preview`,
    );
  }

  return parseDotenvContents(contents, filePath);
}

export function parseDotenvContents(
  contents: string,
  filePath: string,
): VariableAssignment[] {
  const keys = scanKeys(contents);
  if (keys.length === 0) {
    throw usageError(
      `No variables found in "${filePath}"`,
      "The file has no KEY=VALUE lines.",
      "Pass a dotenv file with at least one KEY=VALUE line.",
    );
  }

  const firstLine = new Map<string, number>();
  for (const { key, line } of keys) {
    const reason = invalidKeyReason(key);
    if (reason !== null) {
      throw usageError(
        `Variable key "${key}" in "${filePath}" is not valid`,
        `Line ${line}: ${reason}`,
        "Fix the key in the file and run the command again.",
      );
    }
    const earlier = firstLine.get(key);
    if (earlier !== undefined) {
      throw usageError(
        `"${key}" is set twice in "${filePath}"`,
        `Lines ${earlier} and ${line} both set ${key}.`,
        "Keep one line for each key.",
      );
    }
    firstLine.set(key, line);
  }

  const values = parseDotenv(contents);
  return keys.map(({ key, line }) => {
    const value = values[key];
    if (typeof value !== "string" || value.length === 0) {
      throw usageError(
        `"${key}" in "${filePath}" has an empty value`,
        `Line ${line} sets ${key} to an empty value.`,
        "Give the key a value, or remove its line from the file.",
      );
    }
    return { key, value };
  });
}

/** Finds each assigned key and its line number. Lines inside a quoted
 *  multi-line value are skipped, so text in the value is not read as a key. */
function scanKeys(contents: string): Array<{ key: string; line: number }> {
  const keys: Array<{ key: string; line: number }> = [];
  let openQuote: string | null = null;

  for (const [index, line] of contents.split("\n").entries()) {
    if (openQuote !== null) {
      if (hasClosingQuote(line, openQuote, 0)) {
        openQuote = null;
      }
      continue;
    }

    const match = /^\s*(?:export\s+)?([^#=\s]+)\s*=/.exec(line);
    if (!match) {
      continue;
    }
    keys.push({ key: match[1], line: index + 1 });

    const rest = line.slice(match[0].length).trimStart();
    const quote = rest[0];
    if (
      (quote === '"' || quote === "'" || quote === "`") &&
      !hasClosingQuote(rest, quote, 1)
    ) {
      openQuote = quote;
    }
  }

  return keys;
}

function hasClosingQuote(text: string, quote: string, from: number): boolean {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === quote && !isEscaped(text, index)) {
      return true;
    }
  }
  return false;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}
