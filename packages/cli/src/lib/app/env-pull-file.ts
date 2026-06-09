import { execFile } from "node:child_process";
import { chmod, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { RawPulledEnvironmentVariable } from "../../controllers/app-env-api";
import { CliError, usageError } from "../../shell/errors";
import { confirmPrompt } from "../../shell/prompt";
import { canPrompt, type CommandContext } from "../../shell/runtime";
import { validateKey } from "./env-config";

const execFileAsync = promisify(execFile);

export interface PulledEnvFileWrite {
  path: string;
  count: number;
}

export interface PulledEnvFileTarget {
  absolutePath: string;
  relativePath: string;
}

export async function preparePulledEnvFile(
  context: CommandContext,
  outputFile: string,
): Promise<PulledEnvFileTarget> {
  const target = resolveOutputFile(context.runtime.cwd, outputFile);
  await rejectTrackedTarget(context.runtime.cwd, target.relativePath, context.runtime.signal);
  await ensureParentDirectory(context.runtime.cwd, target.relativePath, target.absolutePath);
  await confirmOverwriteIfNeeded(context, target.relativePath, target.absolutePath);
  return target;
}

export async function writePulledEnvFile(
  target: PulledEnvFileTarget,
  variables: RawPulledEnvironmentVariable[],
): Promise<PulledEnvFileWrite> {
  await writeFile(target.absolutePath, serializePulledEnvVariables(variables), {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(target.absolutePath, 0o600);

  return {
    path: target.relativePath,
    count: variables.length,
  };
}

export function serializePulledEnvVariables(variables: RawPulledEnvironmentVariable[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const variable of variables) {
    validatePulledKey(variable.key);
    if (seen.has(variable.key)) {
      throw new CliError({
        code: "ENV_PULL_DUPLICATE_KEY",
        domain: "app",
        summary: `Pulled environment variable "${variable.key}" more than once`,
        why: "The platform returned duplicate keys for one effective env snapshot.",
        fix: "Retry after the platform returns one value per key.",
        exitCode: 1,
        nextSteps: ["prisma-cli project env list --role preview"],
      });
    }
    seen.add(variable.key);
    lines.push(`${variable.key}=${formatDotenvValue(variable.value)}`);
  }

  return `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

function resolveOutputFile(cwd: string, outputFile: string): {
  absolutePath: string;
  relativePath: string;
} {
  if (outputFile.length === 0) {
    throw usageError(
      "prisma-cli project env pull requires a non-empty output file",
      "The output file positional argument was empty.",
      "Pass a local dotenv file path, or omit it to use .env.local.",
      ["prisma-cli project env pull", "prisma-cli project env pull .env"],
      "app",
    );
  }

  const absolutePath = path.resolve(cwd, outputFile);
  const relativePath = path.relative(cwd, absolutePath) || ".";
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw usageError(
      `Refusing to write env file outside the current project`,
      `"${outputFile}" resolves outside the current working directory.`,
      "Choose a path inside the current project.",
      ["prisma-cli project env pull .env.local"],
      "app",
    );
  }

  return {
    absolutePath,
    relativePath,
  };
}

async function rejectTrackedTarget(
  cwd: string,
  relativePath: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await execFileAsync("git", ["ls-files", "--error-unmatch", "--", relativePath], {
      cwd,
      signal,
      timeout: 5_000,
    });
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      throw error;
    }
    return;
  }

  throw new CliError({
    code: "ENV_PULL_TARGET_TRACKED",
    domain: "app",
    summary: `Refusing to write pulled env values to tracked file "${relativePath}"`,
    why: "Pulled preview values may include secrets, and this file is tracked by Git.",
    fix: "Choose an ignored local file such as .env.local, or remove the target file from Git tracking first.",
    exitCode: 1,
    nextSteps: ["prisma-cli project env pull .env.local"],
  });
}

async function ensureParentDirectory(
  cwd: string,
  relativePath: string,
  absolutePath: string,
): Promise<void> {
  const parentAbsolutePath = path.dirname(absolutePath);
  const parentRelativePath = path.relative(cwd, parentAbsolutePath) || ".";

  try {
    const stats = await stat(parentAbsolutePath);
    if (!stats.isDirectory()) {
      throw new CliError({
        code: "ENV_PULL_PARENT_NOT_DIRECTORY",
        domain: "app",
        summary: `Env pull parent "${parentRelativePath}" is not a directory`,
        why: `The output file "${relativePath}" cannot be created under a non-directory path.`,
        fix: "Choose a file path inside an existing project directory.",
        exitCode: 1,
        nextSteps: ["prisma-cli project env pull .env.local"],
      });
    }
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new CliError({
        code: "ENV_PULL_PARENT_MISSING",
        domain: "app",
        summary: `Env pull parent "${parentRelativePath}" does not exist`,
        why: `The output file "${relativePath}" cannot be created before its parent directory exists.`,
        fix: "Create the parent directory first, or choose another output file.",
        exitCode: 1,
        nextSteps: ["prisma-cli project env pull .env.local"],
      });
    }
    throw new CliError({
      code: "ENV_PULL_PARENT_UNREADABLE",
      domain: "app",
      summary: `Could not inspect env pull parent "${parentRelativePath}"`,
      why: error instanceof Error ? error.message : "The output directory could not be inspected.",
      fix: "Choose a readable file path inside the current project.",
      exitCode: 1,
      nextSteps: ["prisma-cli project env pull .env.local"],
    });
  }
}

async function confirmOverwriteIfNeeded(
  context: CommandContext,
  relativePath: string,
  absolutePath: string,
): Promise<void> {
  if (!(await targetFileExists(relativePath, absolutePath))) {
    return;
  }

  if (context.flags.yes) {
    return;
  }

  if (!canPrompt(context)) {
    throw new CliError({
      code: "CONFIRMATION_REQUIRED",
      domain: "app",
      summary: `Env pull requires confirmation to overwrite "${relativePath}"`,
      why: "The target file already exists and the command cannot prompt in the current mode.",
      fix: "Pass --yes to overwrite it, or choose a different output file.",
      exitCode: 1,
      nextSteps: [
        `prisma-cli project env pull ${relativePath} --yes`,
        "prisma-cli project env pull .env.local",
      ],
    });
  }

  const shouldOverwrite = await confirmPrompt({
    input: context.runtime.stdin,
    output: context.output.stderr,
    message: `Overwrite ${relativePath}?`,
    initialValue: false,
  });

  if (!shouldOverwrite) {
    throw new CliError({
      code: "ENV_PULL_CANCELED",
      domain: "app",
      summary: `Env pull canceled before overwriting "${relativePath}"`,
      why: "The existing local env file was left unchanged.",
      fix: "Choose another output file, or rerun with --yes to overwrite.",
      exitCode: 1,
      nextSteps: ["prisma-cli project env pull .env.local"],
    });
  }
}

async function targetFileExists(relativePath: string, absolutePath: string): Promise<boolean> {
  try {
    const stats = await stat(absolutePath);
    if (!stats.isFile()) {
      throw new CliError({
        code: "ENV_PULL_TARGET_NOT_FILE",
        domain: "app",
        summary: `Env pull target "${relativePath}" is not a file`,
        why: "The output path already exists but cannot be overwritten as a dotenv file.",
        fix: "Choose a file path inside the current project.",
        exitCode: 1,
        nextSteps: ["prisma-cli project env pull .env.local"],
      });
    }
    return true;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw new CliError({
      code: "ENV_PULL_TARGET_UNREADABLE",
      domain: "app",
      summary: `Could not inspect env pull target "${relativePath}"`,
      why: error instanceof Error ? error.message : "The output path could not be inspected.",
      fix: "Choose a readable file path inside the current project.",
      exitCode: 1,
      nextSteps: ["prisma-cli project env pull .env.local"],
    });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function validatePulledKey(key: string): void {
  try {
    validateKey(key, "add");
  } catch {
    throw new CliError({
      code: "ENV_PULL_INVALID_KEY",
      domain: "app",
      summary: `Pulled environment variable "${key}" is not a valid env-var key`,
      why: "The platform returned a key that cannot be written to a dotenv file safely.",
      fix: "Retry after the platform returns POSIX-shaped environment variable keys.",
      exitCode: 1,
      nextSteps: [],
    });
  }
}

function formatDotenvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}
