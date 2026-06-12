import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { CommandContext } from "../../shell/runtime";

export type BranchDatabaseSchemaCommand =
  | "migrate-deploy"
  | "db-push"
  | "prisma-next-db-init";
export type BranchDatabaseSchemaSourceKind = "prisma-orm" | "prisma-next";

export type UnsupportedBranchDatabaseSchemaTarget =
  | "mongodb"
  | "mysql"
  | "sqlite"
  | "sqlserver"
  | "cockroachdb";

export interface BranchDatabaseSchema {
  kind: BranchDatabaseSchemaSourceKind;
  path: string;
  command: BranchDatabaseSchemaCommand;
  hasMigrations: boolean;
  target: "postgresql" | "unknown";
}

export interface UnsupportedBranchDatabaseSchema {
  kind: BranchDatabaseSchemaSourceKind;
  path: string;
  target: UnsupportedBranchDatabaseSchemaTarget;
}

export interface BranchDatabaseSignal {
  schema: BranchDatabaseSchema | null;
  unsupportedSchema: UnsupportedBranchDatabaseSchema | null;
  databaseUrlReferences: string[];
}

export interface BranchDatabaseSchemaSetupResult {
  command: BranchDatabaseSchemaCommand;
  source: BranchDatabaseSchemaSourceKind;
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
  ".wrangler",
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
    prismaNextConfigCandidates: [],
    databaseUrlReferences: [],
  };

  await scanDirectory(cwd, cwd, 0, state, signal);

  const prismaNextConfigs = await Promise.all(
    state.prismaNextConfigCandidates.map((configPath) =>
      classifyPrismaNextConfig(configPath, signal),
    ),
  );
  const supportedPrismaNextConfig = selectPrismaNextConfig(
    cwd,
    prismaNextConfigs,
    "supported",
  );
  const unsupportedPrismaNextConfig = selectPrismaNextConfig(
    cwd,
    prismaNextConfigs,
    "unsupported",
  );
  const selectedPrismaOrmSchema = await selectPrismaOrmSchema(
    cwd,
    state.schemaCandidates,
    signal,
  );

  const schema = supportedPrismaNextConfig
    ? {
        kind: "prisma-next" as const,
        path: supportedPrismaNextConfig.path,
        hasMigrations: false,
        command: "prisma-next-db-init" as const,
        target: supportedPrismaNextConfig.target,
      }
    : selectedPrismaOrmSchema.schema;
  const unsupportedSchema = schema
    ? null
    : unsupportedPrismaNextConfig
      ? {
          kind: "prisma-next" as const,
          path: unsupportedPrismaNextConfig.path,
          target: unsupportedPrismaNextConfig.target,
        }
      : selectedPrismaOrmSchema.unsupportedSchema;

  return {
    schema,
    unsupportedSchema,
    databaseUrlReferences: state.databaseUrlReferences,
  };
}

export function hasBranchDatabaseSignal(signal: BranchDatabaseSignal): boolean {
  if (signal.unsupportedSchema) {
    return false;
  }
  return Boolean(signal.schema || signal.databaseUrlReferences.length > 0);
}

export async function runBranchDatabaseSchemaSetup(options: {
  context: CommandContext;
  schema: BranchDatabaseSchema;
  databaseUrl: string;
  directUrl: string | null;
}): Promise<BranchDatabaseSchemaSetupResult> {
  const schemaPath =
    path.relative(options.context.runtime.cwd, options.schema.path) ||
    defaultSchemaSourcePath(options.schema);
  const prisma = await resolvePrismaInvocation(options.context.runtime.cwd);
  const commands = buildSchemaSetupCommands(
    options.schema,
    schemaPath,
    options.databaseUrl,
    prisma,
  );

  for (const command of commands) {
    await runPrismaCommand({
      context: options.context,
      ...command,
      env: {
        DATABASE_URL: options.databaseUrl,
        ...(options.directUrl ? { DIRECT_URL: options.directUrl } : {}),
      },
    });
  }

  return {
    command: options.schema.command,
    source: options.schema.kind,
    schemaPath,
  };
}

interface ScanState {
  filesVisited: number;
  schemaCandidates: string[];
  prismaNextConfigCandidates: string[];
  databaseUrlReferences: string[];
}

interface ClassifiedPrismaNextConfig {
  path: string;
  target: "postgresql" | "unknown" | UnsupportedBranchDatabaseSchemaTarget;
}

interface PrismaOrmSchemaSelection {
  schema: BranchDatabaseSchema | null;
  unsupportedSchema: UnsupportedBranchDatabaseSchema | null;
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

  const entries = await readDirectoryEntries(directory);
  if (!entries) return;

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    signal.throwIfAborted();
    if (state.filesVisited >= MAX_SCAN_FILES) {
      return;
    }

    await scanDirectoryEntry(cwd, directory, entry, depth, state, signal);
  }
}

async function readDirectoryEntries(
  directory: string,
): Promise<Dirent[] | null> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function scanDirectoryEntry(
  cwd: string,
  directory: string,
  entry: Dirent,
  depth: number,
  state: ScanState,
  signal: AbortSignal,
): Promise<void> {
  const entryPath = path.join(directory, entry.name);
  if (entry.isDirectory()) {
    if (!SKIPPED_DIRECTORIES.has(entry.name)) {
      await scanDirectory(cwd, entryPath, depth + 1, state, signal);
    }
    return;
  }

  if (!entry.isFile()) {
    return;
  }

  state.filesVisited += 1;
  collectBranchDatabaseCandidate(entryPath, entry.name, state);

  if (
    await shouldRecordDatabaseUrlReference(entryPath, entry.name, state, signal)
  ) {
    state.databaseUrlReferences.push(
      path.relative(cwd, entryPath) || entry.name,
    );
  }
}

function collectBranchDatabaseCandidate(
  entryPath: string,
  entryName: string,
  state: ScanState,
): void {
  if (entryName === "schema.prisma") {
    state.schemaCandidates.push(entryPath);
  }

  if (isPrismaNextConfigFile(entryName)) {
    state.prismaNextConfigCandidates.push(entryPath);
  }
}

async function shouldRecordDatabaseUrlReference(
  entryPath: string,
  entryName: string,
  state: ScanState,
  signal: AbortSignal,
): Promise<boolean> {
  return (
    state.databaseUrlReferences.length < MAX_DATABASE_URL_REFERENCE_FILES &&
    shouldScanForDatabaseUrl(entryName) &&
    (await fileContainsDatabaseUrl(entryPath, signal))
  );
}

async function selectPrismaOrmSchema(
  cwd: string,
  candidates: string[],
  signal: AbortSignal,
): Promise<PrismaOrmSchemaSelection> {
  const sorted = sortByPreferredRelativePath(cwd, candidates, "schema.prisma");

  for (const schemaPath of sorted) {
    const target = await classifyPrismaOrmSchemaTarget(schemaPath, signal);
    if (target === "postgresql" || target === "unknown") {
      const hasMigrations = await hasMigrationsDirectory(
        path.dirname(schemaPath),
        signal,
      );
      return {
        schema: {
          kind: "prisma-orm",
          path: schemaPath,
          hasMigrations,
          command: hasMigrations ? "migrate-deploy" : "db-push",
          target,
        },
        unsupportedSchema: null,
      };
    }

    return {
      schema: null,
      unsupportedSchema: {
        kind: "prisma-orm",
        path: schemaPath,
        target,
      },
    };
  }

  return {
    schema: null,
    unsupportedSchema: null,
  };
}

function selectPrismaNextConfig(
  cwd: string,
  candidates: ClassifiedPrismaNextConfig[],
  mode: "supported" | "unsupported",
): ClassifiedPrismaNextConfig | null {
  const matches = candidates.filter((candidate) => {
    const isSupported =
      candidate.target === "postgresql" || candidate.target === "unknown";
    return mode === "supported" ? isSupported : !isSupported;
  });

  return (
    sortByPreferredRelativePath(
      cwd,
      matches.map((candidate) => candidate.path),
      "prisma-next.config.ts",
    )
      .map((candidatePath) =>
        matches.find((candidate) => candidate.path === candidatePath),
      )
      .find((candidate): candidate is ClassifiedPrismaNextConfig =>
        Boolean(candidate),
      ) ?? null
  );
}

function sortByPreferredRelativePath(
  cwd: string,
  candidates: string[],
  preferredRootFile: string,
): string[] {
  return candidates
    .map((candidate) => ({
      absolute: candidate,
      relative: path.relative(cwd, candidate) || preferredRootFile,
    }))
    .sort((left, right) => {
      if (left.relative === preferredRootFile) return -1;
      if (right.relative === preferredRootFile) return 1;
      return (
        left.relative.length - right.relative.length ||
        left.relative.localeCompare(right.relative)
      );
    })
    .map((candidate) => candidate.absolute);
}

async function hasMigrationsDirectory(
  schemaDirectory: string,
  signal: AbortSignal,
): Promise<boolean> {
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

async function classifyPrismaNextConfig(
  configPath: string,
  signal: AbortSignal,
): Promise<ClassifiedPrismaNextConfig> {
  const content = await readTextFileIfSmall(configPath, signal);
  if (!content) {
    return {
      path: configPath,
      target: "unknown",
    };
  }

  if (content.includes("@prisma-next/postgres/config")) {
    return {
      path: configPath,
      target: "postgresql",
    };
  }
  if (content.includes("@prisma-next/mongo/config")) {
    return {
      path: configPath,
      target: "mongodb",
    };
  }
  if (content.includes("@prisma-next/sqlite/config")) {
    return {
      path: configPath,
      target: "sqlite",
    };
  }

  return {
    path: configPath,
    target: "unknown",
  };
}

async function classifyPrismaOrmSchemaTarget(
  schemaPath: string,
  signal: AbortSignal,
): Promise<"postgresql" | "unknown" | UnsupportedBranchDatabaseSchemaTarget> {
  const content = await readTextFileIfSmall(schemaPath, signal);
  const provider = content?.match(/\bprovider\s*=\s*"([^"]+)"/)?.[1] ?? null;

  switch (provider) {
    case "postgresql":
      return "postgresql";
    case "mongodb":
      return "mongodb";
    case "mysql":
      return "mysql";
    case "sqlite":
      return "sqlite";
    case "sqlserver":
      return "sqlserver";
    case "cockroachdb":
      return "cockroachdb";
    default:
      return "unknown";
  }
}

function shouldScanForDatabaseUrl(fileName: string): boolean {
  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return true;
  }
  return DATABASE_URL_SCAN_EXTENSIONS.has(path.extname(fileName));
}

function isPrismaNextConfigFile(fileName: string): boolean {
  if (!fileName.startsWith("prisma-next.config.")) {
    return false;
  }

  return [".cjs", ".cts", ".js", ".mjs", ".mts", ".ts"].some((extension) =>
    fileName.endsWith(extension),
  );
}

async function fileContainsDatabaseUrl(
  filePath: string,
  signal: AbortSignal,
): Promise<boolean> {
  const content = await readTextFileIfSmall(filePath, signal);
  return content?.includes("DATABASE_URL") ?? false;
}

async function readTextFileIfSmall(
  filePath: string,
  signal: AbortSignal,
): Promise<string | null> {
  signal.throwIfAborted();

  const info = await stat(filePath);
  if (info.size > MAX_TEXT_FILE_BYTES) {
    return null;
  }

  return readFile(filePath, { encoding: "utf8", signal });
}

// Last resort for repos that ship a schema with no Prisma packages
// installed at all. Pinned to the 6.x line: Prisma 7 rejects the classic
// `url = env(...)` datasource form (P1012), which is exactly the schema
// shape such repos have. Bump deliberately, never to `latest`.
const FALLBACK_PRISMA_CLI_VERSION = "6.19.3";

interface PrismaInvocation {
  argsPrefix: string[];
  displayPrefix: string;
}

/**
 * Picks how `prisma` CLI commands are invoked for schema setup. Projects
 * with the CLI installed run their own binary (version-exact). Projects
 * without it fall back to a versioned `npx prisma@<x>` pinned to the
 * installed `@prisma/client` — never bare `npx prisma`, which resolves to
 * latest and can be a major version ahead of the project's schema.
 */
async function resolvePrismaInvocation(cwd: string): Promise<PrismaInvocation> {
  if (await localPrismaBinExists(cwd)) {
    return {
      argsPrefix: ["--no-install", "prisma"],
      displayPrefix: "npx --no-install prisma",
    };
  }

  const clientVersion = await readInstalledPrismaClientVersion(cwd);
  const pinned = clientVersion ?? FALLBACK_PRISMA_CLI_VERSION;
  return {
    argsPrefix: ["--yes", `prisma@${pinned}`],
    displayPrefix: `npx prisma@${pinned}`,
  };
}

/** npm/pnpm name the local CLI shim `prisma` on POSIX and `prisma.cmd`/`prisma.ps1` on Windows. */
async function localPrismaBinExists(cwd: string): Promise<boolean> {
  const binDir = path.join(cwd, "node_modules", ".bin");
  const checks = await Promise.all(
    ["prisma", "prisma.cmd", "prisma.ps1"].map((name) =>
      fileExists(path.join(binDir, name)),
    ),
  );
  return checks.some(Boolean);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readInstalledPrismaClientVersion(
  cwd: string,
): Promise<string | null> {
  try {
    const raw = await readFile(
      path.join(cwd, "node_modules", "@prisma", "client", "package.json"),
      { encoding: "utf8" },
    );
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const version = (parsed as { version?: unknown }).version;
    return typeof version === "string" && version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

function buildSchemaSetupCommands(
  schema: BranchDatabaseSchema,
  schemaPath: string,
  databaseUrl: string,
  prisma: PrismaInvocation,
): Array<{
  args: string[];
  displayCommand: string;
}> {
  if (schema.command === "migrate-deploy") {
    return [
      {
        args: [
          ...prisma.argsPrefix,
          "migrate",
          "deploy",
          "--schema",
          schemaPath,
        ],
        displayCommand: `${prisma.displayPrefix} migrate deploy`,
      },
    ];
  }

  if (schema.command === "db-push") {
    return [
      {
        args: [...prisma.argsPrefix, "db", "push", "--schema", schemaPath],
        displayCommand: `${prisma.displayPrefix} db push`,
      },
    ];
  }

  return [
    {
      args: [
        "--no-install",
        "prisma-next",
        "contract",
        "emit",
        "--config",
        schemaPath,
      ],
      displayCommand: "npx --no-install prisma-next contract emit",
    },
    {
      args: [
        "--no-install",
        "prisma-next",
        "db",
        "init",
        "--config",
        schemaPath,
        "--db",
        databaseUrl,
      ],
      displayCommand: "npx --no-install prisma-next db init",
    },
  ];
}

function defaultSchemaSourcePath(schema: BranchDatabaseSchema): string {
  return schema.kind === "prisma-next"
    ? "prisma-next.config.ts"
    : "schema.prisma";
}

async function runPrismaCommand(options: {
  context: CommandContext;
  args: string[];
  displayCommand: string;
  env: Record<string, string>;
}): Promise<void> {
  const shouldPipeOutput =
    !options.context.flags.json && !options.context.flags.quiet;
  const child = spawn("npx", options.args, {
    cwd: options.context.runtime.cwd,
    env: {
      ...options.context.runtime.env,
      ...options.env,
    },
    signal: options.context.runtime.signal,
    stdio: shouldPipeOutput
      ? ["ignore", "pipe", "pipe"]
      : ["ignore", "ignore", "ignore"],
  });

  if (shouldPipeOutput) {
    child.stdout?.pipe(options.context.output.stderr, { end: false });
    child.stderr?.pipe(options.context.output.stderr, { end: false });
  }

  const exit = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  if (exit.signal) {
    throw new Error(
      `${options.displayCommand} was terminated by ${exit.signal}.`,
    );
  }

  if (exit.code !== 0) {
    throw new Error(
      `${options.displayCommand} exited with code ${exit.code ?? 1}.`,
    );
  }
}
