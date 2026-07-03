import { randomBytes } from "node:crypto";

import {
  type PrismaCliPackageCommandFormatter,
  resolvePrismaCliPackageCommandFormatterSync,
} from "../lib/agent/cli-command";
import { requireComputeAuth } from "../lib/auth/guard";
import {
  createManagementDatabaseProvider,
  type DatabaseProvider,
  normalizeConnection,
  normalizeDatabase,
} from "../lib/database/provider";
import {
  projectResolutionErrorToCliError,
  type ResolvedProjectTarget,
  resolveProjectTarget,
} from "../lib/project/resolution";
import {
  authRequiredError,
  CliError,
  usageError,
  workspaceRequiredError,
} from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import type {
  DatabaseBackupListResult,
  DatabaseConnectionCreateResult,
  DatabaseConnectionListResult,
  DatabaseConnectionRemoveResult,
  DatabaseConnectionRotateResult,
  DatabaseCreateResult,
  DatabaseListResult,
  DatabaseRemoveResult,
  DatabaseRestoreResult,
  DatabaseShowResult,
  DatabaseSummary,
  DatabaseUsageResult,
} from "../types/database";
import { requireAuthenticatedAuthState } from "./auth";
import {
  listFixtureWorkspaceProjects,
  listRealWorkspaceProjects,
} from "./project";

interface DatabaseCommandFlags {
  projectRef?: string;
  branchName?: string;
}

interface DatabaseCreateFlags extends DatabaseCommandFlags {
  region?: string;
}

interface DatabaseRemoveFlags extends DatabaseCommandFlags {
  confirm?: string;
}

interface DatabaseConnectionCreateFlags extends DatabaseCommandFlags {
  name?: string;
}

interface DatabaseConnectionRemoveFlags {
  confirm?: string;
}

interface DatabaseUsageFlags extends DatabaseCommandFlags {
  from?: string;
  to?: string;
}

interface DatabaseBackupListFlags extends DatabaseCommandFlags {
  limit?: string;
}

interface DatabaseRestoreFlags extends DatabaseCommandFlags {
  backupId?: string;
  sourceDatabaseRef?: string;
  confirm?: string;
}

interface DatabaseConnectionRotateFlags {
  confirm?: string;
}

interface ResolvedDatabaseContext {
  provider: DatabaseProvider;
  target: ResolvedProjectTarget;
}

function isRealMode(context: CommandContext): boolean {
  return (
    !context.runtime.fixturePath &&
    !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH
  );
}

export async function runDatabaseList(
  context: CommandContext,
  flags: DatabaseCommandFlags,
): Promise<CommandSuccess<DatabaseListResult>> {
  const { provider, target } = await requireDatabaseContext(
    context,
    flags,
    "database list",
  );
  const databases = sortDatabases(
    await provider.listDatabases({
      projectId: target.project.id,
      branchName: flags.branchName,
      signal: context.runtime.signal,
    }),
  );

  return {
    command: "database.list",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      branchName: flags.branchName ?? null,
      verboseContext: target,
      databases,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runDatabaseShow(
  context: CommandContext,
  databaseRef: string,
  flags: DatabaseCommandFlags,
): Promise<CommandSuccess<DatabaseShowResult>> {
  const { provider, target } = await requireDatabaseContext(
    context,
    flags,
    "database show",
  );
  const database = await resolveDatabase(
    provider,
    target,
    databaseRef,
    flags.branchName,
    context.runtime.signal,
  );
  const connections = await provider.listConnections(database.id, {
    signal: context.runtime.signal,
  });

  return {
    command: "database.show",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: target,
      database,
      connections,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runDatabaseCreate(
  context: CommandContext,
  name: string,
  flags: DatabaseCreateFlags,
): Promise<CommandSuccess<DatabaseCreateResult>> {
  const databaseName = name.trim();
  if (!databaseName) {
    throw usageError(
      "Database name required",
      "Database create needs a non-empty name.",
      "Pass a database name.",
      ["prisma-cli database create <name>"],
      "database",
    );
  }

  const { provider, target } = await requireDatabaseContext(
    context,
    flags,
    "database create",
  );
  const created = await provider.createDatabase({
    projectId: target.project.id,
    name: databaseName,
    branchName: flags.branchName,
    region: flags.region,
    signal: context.runtime.signal,
  });

  return {
    command: "database.create",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: target,
      database: ensureProjectId(created.database, target.project.id),
      connection: created.connection,
      connectionString: created.connectionString,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runDatabaseRemove(
  context: CommandContext,
  databaseRef: string,
  flags: DatabaseRemoveFlags,
): Promise<CommandSuccess<DatabaseRemoveResult>> {
  const { provider, target } = await requireDatabaseContext(
    context,
    flags,
    "database remove",
  );
  const database = await resolveDatabase(
    provider,
    target,
    databaseRef,
    flags.branchName,
    context.runtime.signal,
  );
  requireExactConfirmation({
    resourceName: "database",
    commandName: "database remove",
    id: database.id,
    confirm: flags.confirm,
  });

  await provider.removeDatabase(database.id, {
    signal: context.runtime.signal,
  });

  return {
    command: "database.remove",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: target,
      database,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runDatabaseConnectionList(
  context: CommandContext,
  databaseRef: string,
  flags: DatabaseCommandFlags,
): Promise<CommandSuccess<DatabaseConnectionListResult>> {
  const { provider, target } = await requireDatabaseContext(
    context,
    flags,
    "database connection list",
  );
  const database = await resolveDatabase(
    provider,
    target,
    databaseRef,
    flags.branchName,
    context.runtime.signal,
  );
  const connections = await provider.listConnections(database.id, {
    signal: context.runtime.signal,
  });

  return {
    command: "database.connection.list",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: target,
      database,
      connections,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runDatabaseConnectionCreate(
  context: CommandContext,
  databaseRef: string,
  flags: DatabaseConnectionCreateFlags,
): Promise<CommandSuccess<DatabaseConnectionCreateResult>> {
  const { provider, target } = await requireDatabaseContext(
    context,
    flags,
    "database connection create",
  );
  const database = await resolveDatabase(
    provider,
    target,
    databaseRef,
    flags.branchName,
    context.runtime.signal,
  );
  const created = await provider.createConnection({
    databaseId: database.id,
    name: flags.name?.trim() || defaultConnectionName(),
    signal: context.runtime.signal,
  });

  return {
    command: "database.connection.create",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: target,
      database,
      connection: created.connection,
      connectionString: created.connectionString,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runDatabaseConnectionRemove(
  context: CommandContext,
  connectionRef: string,
  flags: DatabaseConnectionRemoveFlags,
): Promise<CommandSuccess<DatabaseConnectionRemoveResult>> {
  const connectionId = connectionRef.trim();
  if (!connectionId) {
    throw usageError(
      "Connection id required",
      "Database connection removal needs a connection id.",
      "Pass the connection id to remove.",
      [
        "prisma-cli database connection remove <connection-id> --confirm <connection-id>",
      ],
      "database",
    );
  }

  requireExactConfirmation({
    resourceName: "database connection",
    commandName: "database connection remove",
    id: connectionId,
    confirm: flags.confirm,
  });

  const provider = await requireDatabaseProviderOnly(context);
  await provider.removeConnection(connectionId, {
    signal: context.runtime.signal,
  });

  return {
    command: "database.connection.remove",
    result: {
      connection: {
        id: connectionId,
      },
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runDatabaseUsage(
  context: CommandContext,
  databaseRef: string,
  flags: DatabaseUsageFlags,
): Promise<CommandSuccess<DatabaseUsageResult>> {
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(
    context.runtime.cwd,
  );
  const from = parseUsageDate(flags.from, "--from", "start", formatCommand);
  const to = parseUsageDate(flags.to, "--to", "end", formatCommand);
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw usageError(
      "Invalid usage period",
      "--from must not be later than --to.",
      "Pass a --from date that is on or before the --to date.",
      [
        formatCommand([
          "database",
          "usage",
          "<database>",
          "--from",
          "2026-06-01",
          "--to",
          "2026-06-30",
        ]),
      ],
      "database",
    );
  }

  const { provider, target } = await requireDatabaseContext(
    context,
    flags,
    "database usage",
  );
  const database = await resolveDatabase(
    provider,
    target,
    databaseRef,
    flags.branchName,
    context.runtime.signal,
  );
  const usage = await provider.getUsage(database.id, {
    from,
    to,
    signal: context.runtime.signal,
  });

  return {
    command: "database.usage",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: target,
      database,
      period: usage.period,
      metrics: usage.metrics,
      generatedAt: usage.generatedAt,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runDatabaseBackupList(
  context: CommandContext,
  databaseRef: string,
  flags: DatabaseBackupListFlags,
): Promise<CommandSuccess<DatabaseBackupListResult>> {
  const limit = parseBackupLimit(
    flags.limit,
    resolvePrismaCliPackageCommandFormatterSync(context.runtime.cwd),
  );

  const { provider, target } = await requireDatabaseContext(
    context,
    flags,
    "database backup list",
  );
  const database = await resolveDatabase(
    provider,
    target,
    databaseRef,
    flags.branchName,
    context.runtime.signal,
  );
  const backups = await provider.listBackups(database.id, {
    limit,
    signal: context.runtime.signal,
  });

  return {
    command: "database.backup.list",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: target,
      database,
      backups: backups.backups,
      retentionDays: backups.retentionDays,
      hasMore: backups.hasMore,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runDatabaseRestore(
  context: CommandContext,
  databaseRef: string,
  flags: DatabaseRestoreFlags,
): Promise<CommandSuccess<DatabaseRestoreResult>> {
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(
    context.runtime.cwd,
  );
  const backupId = flags.backupId?.trim();
  if (!backupId) {
    throw usageError(
      "Backup id required",
      "Database restore needs the backup to restore from.",
      `Pass --backup <backup-id> from ${formatCommand(["database", "backup", "list", "<database>"])}.`,
      [formatCommand(["database", "backup", "list", "<database>"])],
      "database",
    );
  }

  const { provider, target } = await requireDatabaseContext(
    context,
    flags,
    "database restore",
  );
  const database = await resolveDatabase(
    provider,
    target,
    databaseRef,
    flags.branchName,
    context.runtime.signal,
  );
  const sourceDatabase = flags.sourceDatabaseRef
    ? await resolveDatabase(
        provider,
        target,
        flags.sourceDatabaseRef,
        flags.branchName,
        context.runtime.signal,
      )
    : database;

  const sourceDatabaseArg =
    sourceDatabase.id === database.id
      ? ""
      : ` --source-database ${sourceDatabase.id}`;
  requireExactConfirmation({
    resourceName: "database",
    commandName: "database restore",
    id: database.id,
    confirm: flags.confirm,
    summary: "Confirm database restore",
    why: "Restoring immediately and irreversibly overwrites all data in the target database, so it requires the exact target database id.",
    nextStep: `${formatCommand(["database", "restore", database.id, "--backup", backupId])}${sourceDatabaseArg} --confirm ${database.id}`,
  });

  const restored = await provider.restoreDatabase({
    targetDatabaseId: database.id,
    sourceDatabaseId: sourceDatabase.id,
    backupId,
    projectId: target.project.id,
    signal: context.runtime.signal,
  });

  return {
    command: "database.restore",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: target,
      database: ensureProjectId(restored, target.project.id),
      source: {
        databaseId: sourceDatabase.id,
        backupId,
      },
    },
    warnings: [],
    nextSteps: [formatCommand(["database", "show", database.id])],
  };
}

export async function runDatabaseConnectionRotate(
  context: CommandContext,
  connectionRef: string,
  flags: DatabaseConnectionRotateFlags,
): Promise<CommandSuccess<DatabaseConnectionRotateResult>> {
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(
    context.runtime.cwd,
  );
  const connectionId = connectionRef.trim();
  if (!connectionId) {
    throw usageError(
      "Connection id required",
      "Database connection rotation needs a connection id.",
      "Pass the connection id to rotate.",
      [
        formatCommand([
          "database",
          "connection",
          "rotate",
          "<connection-id>",
          "--confirm",
          "<connection-id>",
        ]),
      ],
      "database",
    );
  }

  requireExactConfirmation({
    resourceName: "database connection",
    commandName: "database connection rotate",
    id: connectionId,
    confirm: flags.confirm,
    summary: "Confirm database connection rotation",
    why: "Rotating revokes the previous credentials and breaks clients still using them, so it requires the exact connection id.",
    nextStep: formatCommand([
      "database",
      "connection",
      "rotate",
      connectionId,
      "--confirm",
      connectionId,
    ]),
  });

  const provider = await requireDatabaseProviderOnly(context);
  const rotated = await provider.rotateConnection(connectionId, {
    signal: context.runtime.signal,
  });

  return {
    command: "database.connection.rotate",
    result: {
      connection: rotated.connection,
      database: rotated.database,
      connectionString: rotated.connectionString,
    },
    warnings: [],
    nextSteps: [],
  };
}

const USAGE_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const USAGE_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

function parseUsageDate(
  value: string | undefined,
  flagName: string,
  dayBoundary: "start" | "end",
  formatCommand: PrismaCliPackageCommandFormatter,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  // The Management API validates startDate/endDate as full ISO datetimes, so
  // date-only input is expanded to a full UTC day boundary: --from to the
  // start of its day, --to to the end, keeping `--from X --to Y` a
  // calendar-day-inclusive range without relying on server-side end-of-day
  // handling. Date.parse alone is too permissive: it rolls over invalid
  // calendar dates such as 2026-02-30, so the date part must round-trip
  // through toISOString unchanged.
  const trimmed = value.trim();
  if (USAGE_DATE_ONLY_PATTERN.test(trimmed) && isValidCalendarDate(trimmed)) {
    return dayBoundary === "start"
      ? `${trimmed}T00:00:00.000Z`
      : `${trimmed}T23:59:59.999Z`;
  }
  if (
    USAGE_DATETIME_PATTERN.test(trimmed) &&
    !Number.isNaN(Date.parse(trimmed)) &&
    isValidCalendarDate(trimmed.slice(0, 10))
  ) {
    return trimmed;
  }

  throw usageError(
    "Invalid usage period",
    `${flagName} must be an ISO date such as 2026-06-01 or an ISO datetime such as 2026-06-01T12:00:00Z.`,
    `Pass an ISO date or datetime to ${flagName}.`,
    [
      formatCommand([
        "database",
        "usage",
        "<database>",
        "--from",
        "2026-06-01",
        "--to",
        "2026-06-30",
      ]),
    ],
    "database",
  );
}

function isValidCalendarDate(datePart: string): boolean {
  const timestamp = Date.parse(`${datePart}T00:00:00.000Z`);
  return (
    !Number.isNaN(timestamp) &&
    new Date(timestamp).toISOString().startsWith(datePart)
  );
}

function parseBackupLimit(
  value: string | undefined,
  formatCommand: PrismaCliPackageCommandFormatter,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const limit = Number(value.trim());
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw usageError(
      "Invalid backup limit",
      "--limit must be an integer between 1 and 100.",
      "Pass a --limit between 1 and 100.",
      [
        formatCommand([
          "database",
          "backup",
          "list",
          "<database>",
          "--limit",
          "50",
        ]),
      ],
      "database",
    );
  }

  return limit;
}

async function requireDatabaseContext(
  context: CommandContext,
  flags: DatabaseCommandFlags,
  commandName: string,
): Promise<ResolvedDatabaseContext> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (isRealMode(context)) {
    const client = await requireComputeAuth(
      context.runtime.env,
      context.runtime.signal,
    );
    if (!client) {
      throw authRequiredError();
    }

    const targetResult = await resolveProjectTarget({
      context,
      workspace,
      explicitProject: flags.projectRef,
      listProjects: () =>
        listRealWorkspaceProjects(client, workspace, context.runtime.signal),
      commandName,
    });
    if (targetResult.isErr()) {
      throw projectResolutionErrorToCliError(targetResult.error);
    }

    return {
      provider: createManagementDatabaseProvider(client, {
        formatCommand: resolvePrismaCliPackageCommandFormatterSync(
          context.runtime.cwd,
        ),
      }),
      target: targetResult.value,
    };
  }

  const targetResult = await resolveProjectTarget({
    context,
    workspace,
    explicitProject: flags.projectRef,
    listProjects: async () => listFixtureWorkspaceProjects(context, workspace),
    commandName,
  });
  if (targetResult.isErr()) {
    throw projectResolutionErrorToCliError(targetResult.error);
  }

  return {
    provider: createFixtureDatabaseProvider(context),
    target: targetResult.value,
  };
}

async function requireDatabaseProviderOnly(
  context: CommandContext,
): Promise<DatabaseProvider> {
  await requireAuthenticatedAuthState(context);

  if (isRealMode(context)) {
    const client = await requireComputeAuth(
      context.runtime.env,
      context.runtime.signal,
    );
    if (!client) {
      throw authRequiredError();
    }
    return createManagementDatabaseProvider(client, {
      formatCommand: resolvePrismaCliPackageCommandFormatterSync(
        context.runtime.cwd,
      ),
    });
  }

  return createFixtureDatabaseProvider(context);
}

function createFixtureDatabaseProvider(
  context: CommandContext,
): DatabaseProvider {
  return {
    async listDatabases(options) {
      return context.api
        .listDatabasesForProject(options.projectId, options.branchName)
        .map((database) => normalizeDatabase(database, database.projectId));
    },

    async showDatabase(databaseId) {
      const database = context.api.getDatabase(databaseId);
      return database ? normalizeDatabase(database, database.projectId) : null;
    },

    async createDatabase(options) {
      const created = context.api.createDatabase(options);
      return {
        database: normalizeDatabase(
          created.database,
          created.database.projectId,
        ),
        connection: normalizeConnection(
          created.connection,
          created.connection.databaseId,
        ),
        connectionString: created.connectionString,
      };
    },

    async removeDatabase(databaseId) {
      const removed = context.api.removeDatabase(databaseId);
      if (!removed) {
        throw databaseNotFoundError(databaseId);
      }
    },

    async listConnections(databaseId) {
      if (!context.api.getDatabase(databaseId)) {
        throw databaseNotFoundError(databaseId);
      }
      return context.api
        .listDatabaseConnections(databaseId)
        .map((connection) =>
          normalizeConnection(connection, connection.databaseId),
        );
    },

    async createConnection(options) {
      const created = context.api.createDatabaseConnection(options);
      if (!created) {
        throw databaseNotFoundError(options.databaseId);
      }
      return {
        connection: normalizeConnection(
          created.connection,
          created.connection.databaseId,
        ),
        connectionString: created.connectionString,
      };
    },

    async removeConnection(connectionId) {
      const removed = context.api.removeDatabaseConnection(connectionId);
      if (!removed) {
        throw connectionNotFoundError(connectionId);
      }
    },

    async getUsage(databaseId, options) {
      if (!context.api.getDatabase(databaseId)) {
        throw databaseNotFoundError(databaseId);
      }
      return context.api.getDatabaseUsage(databaseId, {
        from: options?.from,
        to: options?.to,
      });
    },

    async listBackups(databaseId, options) {
      if (!context.api.getDatabase(databaseId)) {
        throw databaseNotFoundError(databaseId);
      }
      return context.api.listDatabaseBackups(databaseId, options?.limit);
    },

    async restoreDatabase(options) {
      const restored = context.api.restoreDatabase({
        targetDatabaseId: options.targetDatabaseId,
        sourceDatabaseId: options.sourceDatabaseId,
        backupId: options.backupId,
      });
      if (restored.outcome === "target-not-found") {
        throw databaseNotFoundError(options.targetDatabaseId);
      }
      if (restored.outcome === "backup-not-found") {
        throw backupNotFoundError(
          options.backupId,
          options.sourceDatabaseId,
          resolvePrismaCliPackageCommandFormatterSync(context.runtime.cwd),
        );
      }
      return normalizeDatabase(restored.database, options.projectId);
    },

    async rotateConnection(connectionId) {
      const rotated = context.api.rotateDatabaseConnection(connectionId);
      if (!rotated) {
        throw connectionNotFoundError(connectionId);
      }
      const database = context.api.getDatabase(rotated.connection.databaseId);
      return {
        connection: normalizeConnection(
          rotated.connection,
          rotated.connection.databaseId,
        ),
        database: database ? { id: database.id, name: database.name } : null,
        connectionString: rotated.connectionString,
      };
    },
  };
}

async function resolveDatabase(
  provider: DatabaseProvider,
  target: ResolvedProjectTarget,
  databaseRef: string,
  branchName: string | undefined,
  signal: AbortSignal,
): Promise<DatabaseSummary> {
  const ref = databaseRef.trim();
  if (!ref) {
    throw usageError(
      "Database id or name required",
      "This command needs a database id or name.",
      "Pass a database id or name.",
      ["prisma-cli database list"],
      "database",
    );
  }

  const databases = await provider.listDatabases({
    projectId: target.project.id,
    branchName,
    signal,
  });
  const matches = databases.filter(
    (database) => database.id === ref || database.name === ref,
  );

  if (matches.length === 0) {
    throw databaseNotFoundError(ref, target.project.name, branchName);
  }

  if (matches.length > 1) {
    throw databaseAmbiguousError(ref, matches, branchName);
  }

  const selected = matches[0];
  const shown = await provider.showDatabase(selected.id, {
    projectId: target.project.id,
    signal,
  });
  return ensureProjectId(shown ?? selected, target.project.id);
}

function ensureProjectId(
  database: DatabaseSummary,
  projectId: string,
): DatabaseSummary {
  return database.projectId ? database : { ...database, projectId };
}

function sortDatabases(databases: DatabaseSummary[]): DatabaseSummary[] {
  return databases.slice().sort((left, right) => {
    const branchOrder = (left.branchName ?? "").localeCompare(
      right.branchName ?? "",
    );
    if (branchOrder !== 0) {
      return branchOrder;
    }

    const nameOrder = left.name.localeCompare(right.name);
    return nameOrder !== 0 ? nameOrder : left.id.localeCompare(right.id);
  });
}

function requireExactConfirmation(options: {
  resourceName: string;
  commandName: string;
  id: string;
  confirm: string | undefined;
  summary?: string;
  why?: string;
  nextStep?: string;
}): void {
  if (options.confirm === options.id) {
    return;
  }

  throw new CliError({
    code: "CONFIRMATION_REQUIRED",
    domain: "database",
    summary: options.summary ?? `Confirm ${options.resourceName} removal`,
    why:
      options.why ??
      `Removing this ${options.resourceName} is destructive and requires the exact id.`,
    fix: `Rerun with --confirm ${options.id}.`,
    exitCode: 2,
    nextSteps: [
      options.nextStep ??
        `prisma-cli ${options.commandName} ${options.id} --confirm ${options.id}`,
    ],
    meta: {
      expectedConfirm: options.id,
      receivedConfirm: options.confirm ?? null,
    },
  });
}

function defaultConnectionName(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 17);
  const suffix = randomBytes(2).toString("hex");
  return `cli-${timestamp}-${suffix}`;
}

function databaseNotFoundError(
  databaseRef: string,
  projectName?: string,
  branchName?: string,
): CliError {
  const scope = projectName
    ? ` in project "${projectName}"${branchName ? ` on branch "${branchName}"` : ""}`
    : "";
  return new CliError({
    code: "DATABASE_NOT_FOUND",
    domain: "database",
    summary: "Database not found",
    why: `No database matched "${databaseRef}"${scope}.`,
    fix: "Pass a database id or name from prisma-cli database list.",
    exitCode: 1,
    nextSteps: ["prisma-cli database list"],
  });
}

function databaseAmbiguousError(
  databaseRef: string,
  matches: DatabaseSummary[],
  branchName: string | undefined,
): CliError {
  return new CliError({
    code: "DATABASE_AMBIGUOUS",
    domain: "database",
    summary: "Database resolution is ambiguous",
    why: branchName
      ? `Multiple databases matched "${databaseRef}" on branch "${branchName}".`
      : `Multiple databases matched "${databaseRef}".`,
    fix: "Pass the database id, or pass --branch <git-name> to narrow the match.",
    exitCode: 1,
    nextSteps: ["prisma-cli database list"],
    meta: {
      matches: matches.map((database) => ({
        id: database.id,
        name: database.name,
        branchName: database.branchName,
      })),
    },
  });
}

function backupNotFoundError(
  backupId: string,
  sourceDatabaseId: string,
  formatCommand: PrismaCliPackageCommandFormatter,
): CliError {
  const listCommand = formatCommand([
    "database",
    "backup",
    "list",
    sourceDatabaseId,
  ]);
  return new CliError({
    code: "DATABASE_BACKUP_NOT_FOUND",
    domain: "database",
    summary: "Database backup not found",
    why: `No backup matched "${backupId}" for database "${sourceDatabaseId}".`,
    fix: `Pass a backup id from ${listCommand}.`,
    exitCode: 1,
    nextSteps: [listCommand],
  });
}

function connectionNotFoundError(connectionId: string): CliError {
  return new CliError({
    code: "DATABASE_CONNECTION_NOT_FOUND",
    domain: "database",
    summary: "Database connection not found",
    why: `No database connection matched "${connectionId}".`,
    fix: "Pass a connection id from prisma-cli database connection list <database>.",
    exitCode: 1,
    nextSteps: ["prisma-cli database connection list <database>"],
  });
}
