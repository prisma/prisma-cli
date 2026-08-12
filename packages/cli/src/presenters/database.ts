import { serializeList } from "../output/patterns";
import type {
  DatabaseBackupListResult,
  DatabaseConnectionListResult,
  DatabaseListResult,
} from "../types/database";

export function serializeDatabaseList(result: DatabaseListResult) {
  return {
    ...serializeList({
      context: {
        project: result.projectName,
        ...(result.branchName ? { branch: result.branchName } : {}),
      },
      items: result.databases.map((database) => ({
        noun: "database",
        label: database.name,
        id: database.id,
        status: database.isDefault ? "default" : null,
      })),
    }),
    projectId: result.projectId,
    branchName: result.branchName,
    databases: result.databases,
  };
}

export function serializeDatabaseConnectionList(
  result: DatabaseConnectionListResult,
) {
  return {
    ...serializeList({
      context: {
        project: result.projectName,
        database: result.database.name,
      },
      items: result.connections.map((connection) => ({
        noun: "connection",
        label: connection.name,
        id: connection.id,
        status: null,
      })),
    }),
    projectId: result.projectId,
    database: result.database,
    connections: result.connections,
  };
}

export function serializeDatabaseBackupList(result: DatabaseBackupListResult) {
  return {
    ...serializeList({
      context: {
        project: result.projectName,
        database: result.database.name,
      },
      items: result.backups.map((backup) => ({
        noun: "backup",
        label: backup.id,
        id: backup.id,
        status: null,
      })),
    }),
    projectId: result.projectId,
    database: result.database,
    backups: result.backups,
    retentionDays: result.retentionDays,
    hasMore: result.hasMore,
  };
}
