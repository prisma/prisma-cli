import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { CommandContext } from "../../shell/runtime";

export type BranchDatabaseSchemaCommand = "migrate-deploy" | "db-push";

export interface BranchDatabaseSignal {
  schema: {
    path: string;
    hasMigrations: boolean;
    command: BranchDatabaseSchemaCommand;
  } | null;
  databaseUrlReferences: string[];
}

export interface BranchDatabaseSchemaSetupResult {
  command: BranchDatabaseSchemaCommand;
  schemaPath: string;
}

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".prisma",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const DATABASE_URL_SCAN_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".env",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".prisma",
  ".ts",
  ".tsx",
]);
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_FILES = 1_000;
const MAX_DATABASE_URL_REFERENCE_FILES = 10;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;

export async function inspectBranchDatabaseSignal(
  cwd: string,
  signal: AbortSignal,
): Promise<BranchDatabaseSignal> {
  const state: ScanState = {
    filesVisited: 0,
    schemaCandidates: [],
    databaseUrlReferences: [],
  };

  await scanDirectory(cwd, cwd, 0, state, signal);

  const schemaPath = selectSchemaPath(cwd, state.schemaCandidates);
  const hasMigrations = schemaPath
    ? await hasMigrationsDirectory(path.dirname(schemaPath), signal)
    : false;
  const schema = schemaPath
    ? {
        path: schemaPath,
        hasMigrations,
        command: hasMigrations
          ? "migrate-deploy" as const
          : "db-push" as const,
      }
    : null;

  return {
    schema,
    databaseUrlReferences: state.databaseUrlReferences,
  };
}

export function hasBranchDatabaseSignal(signal: BranchDatabaseSignal): boolean {
  return Boolean(signal.schema || signal.databaseUrlReferences.length > 0);
}

export async function runBranchDatabaseSchemaSetup(options: {
  context: CommandContext;
  schema: NonNullable<BranchDatabaseSignal["schema"]>;
  databaseUrl: string;
  directUrl: string | null;
}): Promise<BranchDatabaseSchemaSetupResult> {
  const schemaPath = path.relative(options.context.runtime.cwd, options.schema.path) || "schema.prisma";
  const args = buildPrismaSchemaCommandArgs(options.schema.command, schemaPath);

  await runPrismaCommand({
    context: options.context,
    args,
    env: {
      DATABASE_URL: options.databaseUrl,
      ...(options.directUrl ? { DIRECT_URL: options.directUrl } : {}),
    },
  });

  return {
    command: options.schema.command,
    schemaPath,
  };
}

interface ScanState {
  filesVisited: number;
  schemaCandidates: string[];
  databaseUrlReferences: string[];
}

async function scanDirectory(
  cwd: string,
  directory: string,
  depth: number,
  state: ScanState,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();

  if (depth > MAX_SCAN_DEPTH || state.filesVisited >= MAX_SCAN_FILES) {
    return;
  }

  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    signal.throwIfAborted();
    if (state.filesVisited >= MAX_SCAN_FILES) {
      return;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        await scanDirectory(cwd, entryPath, depth + 1, state, signal);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    state.filesVisited += 1;

    if (entry.name === "schema.prisma") {
      state.schemaCandidates.push(entryPath);
    }

    if (
      state.databaseUrlReferences.length < MAX_DATABASE_URL_REFERENCE_FILES
      && shouldScanForDatabaseUrl(entry.name)
      && await fileContainsDatabaseUrl(entryPath, signal)
    ) {
      state.databaseUrlReferences.push(path.relative(cwd, entryPath) || entry.name);
    }
  }
}

function selectSchemaPath(cwd: string, candidates: string[]): string | null {
  return candidates
    .map((candidate) => ({
      absolute: candidate,
      relative: path.relative(cwd, candidate) || "schema.prisma",
    }))
    .sort((left, right) => {
      if (left.relative === "schema.prisma") return -1;
      if (right.relative === "schema.prisma") return 1;
      return left.relative.length - right.relative.length
        || left.relative.localeCompare(right.relative);
    })[0]?.absolute ?? null;
}

async function hasMigrationsDirectory(schemaDirectory: string, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const migrationsPath = path.join(schemaDirectory, "migrations");

  try {
    await access(migrationsPath);
    const entries = await readdir(migrationsPath);
    return entries.length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function shouldScanForDatabaseUrl(fileName: string): boolean {
  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return true;
  }
  return DATABASE_URL_SCAN_EXTENSIONS.has(path.extname(fileName));
}

async function fileContainsDatabaseUrl(filePath: string, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();

  const info = await stat(filePath);
  if (info.size > MAX_TEXT_FILE_BYTES) {
    return false;
  }

  const content = await readFile(filePath, { encoding: "utf8", signal });
  return content.includes("DATABASE_URL");
}

function buildPrismaSchemaCommandArgs(command: BranchDatabaseSchemaCommand, schemaPath: string): string[] {
  if (command === "migrate-deploy") {
    return ["--no-install", "prisma", "migrate", "deploy", "--schema", schemaPath];
  }

  return ["--no-install", "prisma", "db", "push", "--skip-generate", "--schema", schemaPath];
}

async function runPrismaCommand(options: {
  context: CommandContext;
  args: string[];
  env: Record<string, string>;
}): Promise<void> {
  const shouldPipeOutput = !options.context.flags.json && !options.context.flags.quiet;
  const child = spawn("npx", options.args, {
    cwd: options.context.runtime.cwd,
    env: {
      ...options.context.runtime.env,
      ...options.env,
    },
    signal: options.context.runtime.signal,
    stdio: shouldPipeOutput ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "ignore"],
  });

  if (shouldPipeOutput) {
    child.stdout?.pipe(options.context.output.stderr, { end: false });
    child.stderr?.pipe(options.context.output.stderr, { end: false });
  }

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  if (exit.signal) {
    throw new Error(`npx prisma was terminated by ${exit.signal}.`);
  }

  if (exit.code !== 0) {
    throw new Error(`npx prisma exited with code ${exit.code ?? 1}.`);
  }
}
