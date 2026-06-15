import type { Dirent } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

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

    if (isPrismaNextConfigFile(entry.name)) {
      state.prismaNextConfigCandidates.push(entryPath);
    }

    if (
      state.databaseUrlReferences.length < MAX_DATABASE_URL_REFERENCE_FILES &&
      shouldScanForDatabaseUrl(entry.name) &&
      (await fileContainsDatabaseUrl(entryPath, signal))
    ) {
      state.databaseUrlReferences.push(
        path.relative(cwd, entryPath) || entry.name,
      );
    }
  }
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
  mode: "supported",
): (ClassifiedPrismaNextConfig & { target: "postgresql" | "unknown" }) | null;
function selectPrismaNextConfig(
  cwd: string,
  candidates: ClassifiedPrismaNextConfig[],
  mode: "unsupported",
):
  | (ClassifiedPrismaNextConfig & {
      target: UnsupportedBranchDatabaseSchemaTarget;
    })
  | null;
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
