import { Command, Option } from "commander";

import {
  runDatabaseBackupList,
  runDatabaseConnectionCreate,
  runDatabaseConnectionList,
  runDatabaseConnectionRemove,
  runDatabaseConnectionRotate,
  runDatabaseCreate,
  runDatabaseList,
  runDatabaseRemove,
  runDatabaseRestore,
  runDatabaseShow,
  runDatabaseUsage,
} from "../../controllers/database";
import {
  renderDatabaseBackupList,
  renderDatabaseConnectionCreate,
  renderDatabaseConnectionCreateStdout,
  renderDatabaseConnectionList,
  renderDatabaseConnectionRemove,
  renderDatabaseConnectionRotate,
  renderDatabaseConnectionRotateStdout,
  renderDatabaseCreate,
  renderDatabaseCreateStdout,
  renderDatabaseList,
  renderDatabaseRemove,
  renderDatabaseRestore,
  renderDatabaseShow,
  renderDatabaseUsage,
  serializeDatabaseBackupList,
  serializeDatabaseConnectionCreate,
  serializeDatabaseConnectionList,
  serializeDatabaseConnectionRemove,
  serializeDatabaseConnectionRotate,
  serializeDatabaseCreate,
  serializeDatabaseList,
  serializeDatabaseRemove,
  serializeDatabaseRestore,
  serializeDatabaseShow,
  serializeDatabaseUsage,
} from "../../presenters/database";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import {
  addCompactGlobalFlags,
  addGlobalFlags,
} from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
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
  DatabaseUsageResult,
} from "../../types/database";

export function createDatabaseCommand(runtime: CliRuntime): Command {
  const database = attachCommandDescriptor(
    configureRuntimeCommand(new Command("database"), runtime),
    "database",
  );

  addCompactGlobalFlags(database);

  database.addCommand(createDatabaseListCommand(runtime));
  database.addCommand(createDatabaseShowCommand(runtime));
  database.addCommand(createDatabaseCreateCommand(runtime));
  database.addCommand(createDatabaseUsageCommand(runtime));
  database.addCommand(createDatabaseRestoreCommand(runtime));
  database.addCommand(createDatabaseRemoveCommand(runtime));
  database.addCommand(createDatabaseBackupCommand(runtime));
  database.addCommand(createDatabaseConnectionCommand(runtime));

  return database;
}

function addProjectAndBranchOptions(command: Command): Command {
  return command
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(new Option("--branch <git-name>", "Branch git name"));
}

function createDatabaseListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "database.list",
  );

  addProjectAndBranchOptions(command);
  addGlobalFlags(command);

  command.action(async (options) => {
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;

    await runCommand<DatabaseListResult>(
      runtime,
      "database.list",
      options as Record<string, unknown>,
      (context) => runDatabaseList(context, { projectRef, branchName }),
      {
        renderHuman: (context, descriptor, result) =>
          renderDatabaseList(context, descriptor, result),
        renderJson: (result) => serializeDatabaseList(result),
      },
    );
  });

  return command;
}

function createDatabaseShowCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("show"), runtime),
    "database.show",
  );

  command.argument("<database>", "Database id or name");
  addProjectAndBranchOptions(command);
  addGlobalFlags(command);

  command.action(async (databaseRef: string, options) => {
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;

    await runCommand<DatabaseShowResult>(
      runtime,
      "database.show",
      options as Record<string, unknown>,
      (context) =>
        runDatabaseShow(context, databaseRef, { projectRef, branchName }),
      {
        renderHuman: (context, descriptor, result) =>
          renderDatabaseShow(context, descriptor, result),
        renderJson: (result) => serializeDatabaseShow(result),
      },
    );
  });

  return command;
}

function createDatabaseCreateCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("create"), runtime),
    "database.create",
  );

  command
    .argument("<name>", "Database name")
    .addOption(new Option("--region <region>", "Prisma Postgres region id"));
  addProjectAndBranchOptions(command);
  addGlobalFlags(command);

  command.action(async (name: string, options) => {
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;
    const region = (options as { region?: string }).region;

    await runCommand<DatabaseCreateResult>(
      runtime,
      "database.create",
      options as Record<string, unknown>,
      (context) =>
        runDatabaseCreate(context, name, { projectRef, branchName, region }),
      {
        renderStdout: (context, descriptor, result) =>
          renderDatabaseCreateStdout(context, descriptor, result),
        renderHuman: (context, descriptor, result) =>
          renderDatabaseCreate(context, descriptor, result),
        renderJson: (result) => serializeDatabaseCreate(result),
      },
    );
  });

  return command;
}

function createDatabaseUsageCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("usage"), runtime),
    "database.usage",
  );

  command
    .argument("<database>", "Database id or name")
    .addOption(new Option("--from <iso-date>", "Start of the usage period"))
    .addOption(new Option("--to <iso-date>", "End of the usage period"));
  addProjectAndBranchOptions(command);
  addGlobalFlags(command);

  command.action(async (databaseRef: string, options) => {
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;
    const from = (options as { from?: string }).from;
    const to = (options as { to?: string }).to;

    await runCommand<DatabaseUsageResult>(
      runtime,
      "database.usage",
      options as Record<string, unknown>,
      (context) =>
        runDatabaseUsage(context, databaseRef, {
          projectRef,
          branchName,
          from,
          to,
        }),
      {
        renderHuman: (context, descriptor, result) =>
          renderDatabaseUsage(context, descriptor, result),
        renderJson: (result) => serializeDatabaseUsage(result),
      },
    );
  });

  return command;
}

function createDatabaseRestoreCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("restore"), runtime),
    "database.restore",
  );

  command
    .argument("<database>", "Target database id or name")
    .addOption(new Option("--backup <backup-id>", "Backup to restore from"))
    .addOption(
      new Option(
        "--source-database <database>",
        "Database the backup belongs to (defaults to the target)",
      ),
    )
    .addOption(
      new Option(
        "--confirm <database-id>",
        "Exact target database id required to restore",
      ),
    );
  addProjectAndBranchOptions(command);
  addGlobalFlags(command);

  command.action(async (databaseRef: string, options) => {
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;
    const backupId = (options as { backup?: string }).backup;
    const sourceDatabaseRef = (options as { sourceDatabase?: string })
      .sourceDatabase;
    const confirm = (options as { confirm?: string }).confirm;

    await runCommand<DatabaseRestoreResult>(
      runtime,
      "database.restore",
      options as Record<string, unknown>,
      (context) =>
        runDatabaseRestore(context, databaseRef, {
          projectRef,
          branchName,
          backupId,
          sourceDatabaseRef,
          confirm,
        }),
      {
        renderHuman: (context, descriptor, result) =>
          renderDatabaseRestore(context, descriptor, result),
        renderJson: (result) => serializeDatabaseRestore(result),
      },
    );
  });

  return command;
}

function createDatabaseBackupCommand(runtime: CliRuntime): Command {
  const backup = attachCommandDescriptor(
    configureRuntimeCommand(new Command("backup"), runtime),
    "database.backup",
  );

  addCompactGlobalFlags(backup);

  backup.addCommand(createDatabaseBackupListCommand(runtime));

  return backup;
}

function createDatabaseBackupListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "database.backup.list",
  );

  command
    .argument("<database>", "Database id or name")
    .addOption(
      new Option("--limit <n>", "Maximum number of backups to return"),
    );
  addProjectAndBranchOptions(command);
  addGlobalFlags(command);

  command.action(async (databaseRef: string, options) => {
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;
    const limit = (options as { limit?: string }).limit;

    await runCommand<DatabaseBackupListResult>(
      runtime,
      "database.backup.list",
      options as Record<string, unknown>,
      (context) =>
        runDatabaseBackupList(context, databaseRef, {
          projectRef,
          branchName,
          limit,
        }),
      {
        renderHuman: (context, descriptor, result) =>
          renderDatabaseBackupList(context, descriptor, result),
        renderJson: (result) => serializeDatabaseBackupList(result),
      },
    );
  });

  return command;
}

function createDatabaseRemoveCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("remove"), runtime),
    "database.remove",
  );

  command
    .argument("<database>", "Database id or name")
    .addOption(
      new Option(
        "--confirm <database-id>",
        "Exact database id required to remove",
      ),
    );
  addProjectAndBranchOptions(command);
  addGlobalFlags(command);

  command.action(async (databaseRef: string, options) => {
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;
    const confirm = (options as { confirm?: string }).confirm;

    await runCommand<DatabaseRemoveResult>(
      runtime,
      "database.remove",
      options as Record<string, unknown>,
      (context) =>
        runDatabaseRemove(context, databaseRef, {
          projectRef,
          branchName,
          confirm,
        }),
      {
        renderHuman: (context, descriptor, result) =>
          renderDatabaseRemove(context, descriptor, result),
        renderJson: (result) => serializeDatabaseRemove(result),
      },
    );
  });

  return command;
}

function createDatabaseConnectionCommand(runtime: CliRuntime): Command {
  const connection = attachCommandDescriptor(
    configureRuntimeCommand(new Command("connection"), runtime),
    "database.connection",
  );

  addCompactGlobalFlags(connection);

  connection.addCommand(createDatabaseConnectionListCommand(runtime));
  connection.addCommand(createDatabaseConnectionCreateCommand(runtime));
  connection.addCommand(createDatabaseConnectionRotateCommand(runtime));
  connection.addCommand(createDatabaseConnectionRemoveCommand(runtime));

  return connection;
}

function createDatabaseConnectionRotateCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("rotate"), runtime),
    "database.connection.rotate",
  );

  command
    .argument("<connection>", "Connection id")
    .addOption(
      new Option(
        "--confirm <connection-id>",
        "Exact connection id required to rotate",
      ),
    );
  addGlobalFlags(command);

  command.action(async (connectionRef: string, options) => {
    const confirm = (options as { confirm?: string }).confirm;

    await runCommand<DatabaseConnectionRotateResult>(
      runtime,
      "database.connection.rotate",
      options as Record<string, unknown>,
      (context) =>
        runDatabaseConnectionRotate(context, connectionRef, { confirm }),
      {
        renderStdout: (context, descriptor, result) =>
          renderDatabaseConnectionRotateStdout(context, descriptor, result),
        renderHuman: (context, descriptor, result) =>
          renderDatabaseConnectionRotate(context, descriptor, result),
        renderJson: (result) => serializeDatabaseConnectionRotate(result),
      },
    );
  });

  return command;
}

function createDatabaseConnectionListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "database.connection.list",
  );

  command.argument("<database>", "Database id or name");
  addProjectAndBranchOptions(command);
  addGlobalFlags(command);

  command.action(async (databaseRef: string, options) => {
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;

    await runCommand<DatabaseConnectionListResult>(
      runtime,
      "database.connection.list",
      options as Record<string, unknown>,
      (context) =>
        runDatabaseConnectionList(context, databaseRef, {
          projectRef,
          branchName,
        }),
      {
        renderHuman: (context, descriptor, result) =>
          renderDatabaseConnectionList(context, descriptor, result),
        renderJson: (result) => serializeDatabaseConnectionList(result),
      },
    );
  });

  return command;
}

function createDatabaseConnectionCreateCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("create"), runtime),
    "database.connection.create",
  );

  command
    .argument("<database>", "Database id or name")
    .addOption(new Option("--name <name>", "Connection name"));
  addProjectAndBranchOptions(command);
  addGlobalFlags(command);

  command.action(async (databaseRef: string, options) => {
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;
    const name = (options as { name?: string }).name;

    await runCommand<DatabaseConnectionCreateResult>(
      runtime,
      "database.connection.create",
      options as Record<string, unknown>,
      (context) =>
        runDatabaseConnectionCreate(context, databaseRef, {
          projectRef,
          branchName,
          name,
        }),
      {
        renderStdout: (context, descriptor, result) =>
          renderDatabaseConnectionCreateStdout(context, descriptor, result),
        renderHuman: (context, descriptor, result) =>
          renderDatabaseConnectionCreate(context, descriptor, result),
        renderJson: (result) => serializeDatabaseConnectionCreate(result),
      },
    );
  });

  return command;
}

function createDatabaseConnectionRemoveCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("remove"), runtime),
    "database.connection.remove",
  );

  command
    .argument("<connection>", "Connection id")
    .addOption(
      new Option(
        "--confirm <connection-id>",
        "Exact connection id required to remove",
      ),
    );
  addGlobalFlags(command);

  command.action(async (connectionRef: string, options) => {
    const confirm = (options as { confirm?: string }).confirm;

    await runCommand<DatabaseConnectionRemoveResult>(
      runtime,
      "database.connection.remove",
      options as Record<string, unknown>,
      (context) =>
        runDatabaseConnectionRemove(context, connectionRef, { confirm }),
      {
        renderHuman: (context, descriptor, result) =>
          renderDatabaseConnectionRemove(context, descriptor, result),
        renderJson: (result) => serializeDatabaseConnectionRemove(result),
      },
    );
  });

  return command;
}
