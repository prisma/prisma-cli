// biome-ignore-all lint/performance/useTopLevelRegex: Existing dotenv parsing regexes are kept inline for readability.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseDotenv } from "dotenv";

import { usageError } from "../../shell/errors";
import { validateKey } from "./env-config";

export interface EnvFileAssignment {
  key: string;
  value: string;
}

type EnvFileCommand = "add" | "update" | "deploy";

interface ParsedEnvFileKey {
  key: string;
  line: number;
}

const ASSIGNMENT_KEY_PATTERN = /^\s*(?:export\s+)?([^#=\s]+)\s*=/;

export async function readEnvFileAssignments(
  cwd: string,
  filePath: string,
  command: EnvFileCommand,
): Promise<EnvFileAssignment[]> {
  const resolvedPath = path.resolve(cwd, filePath);
  let contents: string;
  try {
    contents = await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw usageError(
      `Failed to read env file "${filePath}"`,
      error instanceof Error ? error.message : "The file could not be read.",
      "Pass a readable dotenv file path.",
      [
        command === "deploy"
          ? "prisma-cli app deploy --env .env"
          : `prisma-cli project env ${command} --file .env --role preview`,
      ],
      "app",
    );
  }

  return parseEnvFileContents(contents, filePath, command);
}

export function parseEnvFileContents(
  contents: string,
  filePath: string,
  command: EnvFileCommand,
): EnvFileAssignment[] {
  const parsedKeys = extractParsedKeys(contents);
  if (parsedKeys.length === 0) {
    throw usageError(
      `No environment variables found in "${filePath}"`,
      "The file does not contain any KEY=VALUE assignments.",
      "Pass a dotenv file with at least one non-empty variable.",
      [],
      "app",
    );
  }

  const seen = new Map<string, number>();
  for (const entry of parsedKeys) {
    validateEnvFileKey(entry.key, entry.line, filePath, command);
    const firstLine = seen.get(entry.key);
    if (firstLine !== undefined) {
      throw usageError(
        `Duplicate environment variable "${entry.key}" in "${filePath}"`,
        `Lines ${firstLine} and ${entry.line} both define ${entry.key}.`,
        "Keep one assignment for each key before importing the file.",
        [],
        "app",
      );
    }
    seen.set(entry.key, entry.line);
  }

  const parsedValues = parseDotenv(contents);
  const assignments = parsedKeys.map(({ key }) => {
    const value = parsedValues[key];
    if (typeof value !== "string" || value.length === 0) {
      const line = seen.get(key);
      throw usageError(
        `Environment variable "${key}" in "${filePath}" has an empty value`,
        line === undefined
          ? `${key} has an empty value.`
          : `Line ${line} defines ${key} with an empty value.`,
        "Pass a non-empty value, or omit the key from the file.",
        [],
        "app",
      );
    }

    return { key, value };
  });

  return assignments;
}

function extractParsedKeys(contents: string): ParsedEnvFileKey[] {
  const keys: ParsedEnvFileKey[] = [];
  let multilineQuote: string | null = null;

  const lines = contents.split(/\n/);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (multilineQuote !== null) {
      if (hasClosingQuote(line, multilineQuote, 0)) {
        multilineQuote = null;
      }
      continue;
    }

    const match = ASSIGNMENT_KEY_PATTERN.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1];
    keys.push({
      key,
      line: lineNumber,
    });

    const valueStart = line.slice(match[0].length).trimStart();
    const openingQuote = valueStart[0];
    if (
      (openingQuote === '"' || openingQuote === "'" || openingQuote === "`") &&
      !hasClosingQuote(valueStart, openingQuote, 1)
    ) {
      multilineQuote = openingQuote;
    }
  }

  return keys;
}

function validateEnvFileKey(
  key: string,
  line: number,
  filePath: string,
  command: EnvFileCommand,
): void {
  try {
    validateKey(key, command === "deploy" ? "add" : command);
  } catch (error) {
    const reason =
      error instanceof Error && error.message.length > 0
        ? error.message
        : "Invalid environment variable key.";
    throw usageError(
      `Invalid environment variable "${key}" in "${filePath}"`,
      `Line ${line}: ${reason}`,
      "Use a valid env-var key and retry the import.",
      [],
      "app",
    );
  }
}

function hasClosingQuote(
  value: string,
  quote: string,
  startIndex: number,
): boolean {
  for (let index = startIndex; index < value.length; index += 1) {
    if (value[index] === quote && !isEscaped(value, index)) {
      return true;
    }
  }
  return false;
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}
