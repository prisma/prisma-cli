import { randomBytes } from "node:crypto";

import { requireComputeAuth } from "../lib/auth/guard";
import {
  createManagementDatabaseProvider,
  normalizeConnection,
  normalizeDatabase,
  type DatabaseProvider,
} from "../lib/database/provider";
import { resolveProjectTarget, type ResolvedProjectTarget } from "../lib/project/resolution";
import { authRequiredError, CliError, usageError, workspaceRequiredError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import type {
  DatabaseConnectionCreateResult,
  DatabaseConnectionListResult,
  DatabaseConnectionRemoveResult,
  DatabaseCreateResult,
  DatabaseListResult,
  DatabaseRemoveResult,
  DatabaseShowResult,
  DatabaseSummary,
} from "../types/database";
import { requireAuthenticatedAuthState } from "./auth";
import { listFixtureWorkspaceProjects, listRealWorkspaceProjects } from "./project";

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

interface ResolvedDatabaseContext {
  provider: DatabaseProvider;
  target: ResolvedProjectTarget;
}

function isRealMode(context: CommandContext): boolean {
  return !context.runtime.fixturePath && !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH;
}

export async function runDatabaseList(
  context: CommandContext,
  flags: DatabaseCommandFlags,
): Promise<CommandSuccess<DatabaseListResult>> {
  const { provider, target } = await requireDatabaseContext(context, flags, "database list");
  const databases = sortDatabases(await provider.listDatabases({
    projectId: target.project.id,
    branchName: flags.branchName,
    signal: context.runtime.signal,
  }));

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
  const { provider, target } = await requireDatabaseContext(context, flags, "database show");
  const database = await resolveDatabase(provider, target, databaseRef, flags.branchName, context.runtime.signal);
  const connections = await provider.listConnections(database.id, { signal: context.runtime.signal });

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

  const { provider, target } = await requireDatabaseContext(context, flags, "database create");
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
  const { provider, target } = await requireDatabaseContext(context, flags, "database remove");
  const database = await resolveDatabase(provider, target, databaseRef, flags.branchName, context.runtime.signal);
  requireExactConfirmation({
    resourceName: "database",
    commandName: "database remove",
    id: database.id,
    confirm: flags.confirm,
  });

  await provider.removeDatabase(database.id, { signal: context.runtime.signal });

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
  const { provider, target } = await requireDatabaseContext(context, flags, "database connection list");
  const database = await resolveDatabase(provider, target, databaseRef, flags.branchName, context.runtime.signal);
  const connections = await provider.listConnections(database.id, { signal: context.runtime.signal });

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
  const { provider, target } = await requireDatabaseContext(context, flags, "database connection create");
  const database = await resolveDatabase(provider, target, databaseRef, flags.branchName, context.runtime.signal);
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
      ["prisma-cli database connection remove <connection-id> --confirm <connection-id>"],
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
  await provider.removeConnection(connectionId, { signal: context.runtime.signal });

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
    const client = await requireComputeAuth(context.runtime.env, context.runtime.signal);
    if (!client) {
      throw authRequiredError();
    }

    const target = await resolveProjectTarget({
      context,
      workspace,
      explicitProject: flags.projectRef,
      listProjects: () => listRealWorkspaceProjects(client, workspace, context.runtime.signal),
      commandName,
    });

    return {
      provider: createManagementDatabaseProvider(client),
      target,
    };
  }

  const target = await resolveProjectTarget({
    context,
    workspace,
    explicitProject: flags.projectRef,
    listProjects: async () => listFixtureWorkspaceProjects(context, workspace),
    commandName,
  });

  return {
    provider: createFixtureDatabaseProvider(context),
    target,
  };
}

async function requireDatabaseProviderOnly(context: CommandContext): Promise<DatabaseProvider> {
  await requireAuthenticatedAuthState(context);

  if (isRealMode(context)) {
    const client = await requireComputeAuth(context.runtime.env, context.runtime.signal);
    if (!client) {
      throw authRequiredError();
    }
    return createManagementDatabaseProvider(client);
  }

  return createFixtureDatabaseProvider(context);
}

function createFixtureDatabaseProvider(context: CommandContext): DatabaseProvider {
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
        database: normalizeDatabase(created.database, created.database.projectId),
        connection: normalizeConnection(created.connection, created.connection.databaseId),
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
        .map((connection) => normalizeConnection(connection, connection.databaseId));
    },

    async createConnection(options) {
      const created = context.api.createDatabaseConnection(options);
      if (!created) {
        throw databaseNotFoundError(options.databaseId);
      }
      return {
        connection: normalizeConnection(created.connection, created.connection.databaseId),
        connectionString: created.connectionString,
      };
    },

    async removeConnection(connectionId) {
      const removed = context.api.removeDatabaseConnection(connectionId);
      if (!removed) {
        throw connectionNotFoundError(connectionId);
      }
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
  const matches = databases.filter((database) => database.id === ref || database.name === ref);

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

function ensureProjectId(database: DatabaseSummary, projectId: string): DatabaseSummary {
  return database.projectId ? database : { ...database, projectId };
}

function sortDatabases(databases: DatabaseSummary[]): DatabaseSummary[] {
  return databases.slice().sort((left, right) => {
    const branchOrder = (left.branchName ?? "").localeCompare(right.branchName ?? "");
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
}): void {
  if (options.confirm === options.id) {
    return;
  }

  throw new CliError({
    code: "CONFIRMATION_REQUIRED",
    domain: "database",
    summary: `Confirm ${options.resourceName} removal`,
    why: `Removing this ${options.resourceName} is destructive and requires the exact id.`,
    fix: `Rerun with --confirm ${options.id}.`,
    exitCode: 2,
    nextSteps: [`prisma-cli ${options.commandName} ${options.id} --confirm ${options.id}`],
    meta: {
      expectedConfirm: options.id,
      receivedConfirm: options.confirm ?? null,
    },
  });
}

function defaultConnectionName(): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
  const suffix = randomBytes(2).toString("hex");
  return `cli-${timestamp}-${suffix}`;
}

function databaseNotFoundError(databaseRef: string, projectName?: string, branchName?: string): CliError {
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

function databaseAmbiguousError(databaseRef: string, matches: DatabaseSummary[], branchName: string | undefined): CliError {
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
