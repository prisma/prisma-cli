import { Command, Option } from "commander";

import {
  runBucketCreate,
  runBucketDelete,
  runBucketKeyCreate,
  runBucketKeyDelete,
  runBucketKeyList,
  runBucketList,
} from "../../controllers/bucket";
import {
  renderBucketCreate,
  renderBucketDelete,
  renderBucketKeyCreate,
  renderBucketKeyCreateStdout,
  renderBucketKeyDelete,
  renderBucketKeyList,
  renderBucketList,
  serializeBucketCreate,
  serializeBucketDelete,
  serializeBucketKeyCreate,
  serializeBucketKeyDelete,
  serializeBucketKeyList,
  serializeBucketList,
} from "../../presenters/bucket";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import {
  addCompactGlobalFlags,
  addGlobalFlags,
} from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
import type {
  BucketCreateResult,
  BucketDeleteResult,
  BucketKeyCreateResult,
  BucketKeyDeleteResult,
  BucketKeyListResult,
  BucketListResult,
} from "../../types/bucket";

export function createBucketCommand(runtime: CliRuntime): Command {
  const bucket = attachCommandDescriptor(
    configureRuntimeCommand(new Command("bucket"), runtime),
    "bucket",
  );

  addCompactGlobalFlags(bucket);

  bucket.addCommand(createBucketListCommand(runtime));
  bucket.addCommand(createBucketCreateCommand(runtime));
  bucket.addCommand(createBucketDeleteCommand(runtime));
  bucket.addCommand(createBucketKeyCommand(runtime));

  return bucket;
}

function addProjectAndBranchOptions(command: Command): Command {
  return command
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(new Option("--branch <git-name>", "Branch git name"));
}

function createBucketListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "bucket.list",
  );

  addProjectAndBranchOptions(command);
  addGlobalFlags(command);

  command.action(async (options) => {
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;

    await runCommand<BucketListResult>(
      runtime,
      "bucket.list",
      options as Record<string, unknown>,
      (context) => runBucketList(context, { projectRef, branchName }),
      {
        renderHuman: (context, descriptor, result) =>
          renderBucketList(context, descriptor, result),
        renderJson: (result) => serializeBucketList(result),
      },
    );
  });

  return command;
}

function createBucketCreateCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("create"), runtime),
    "bucket.create",
  );

  command.addOption(
    new Option(
      "--name <name>",
      "Bucket display name (auto-generated if omitted)",
    ),
  );
  addProjectAndBranchOptions(command);
  addGlobalFlags(command);

  command.action(async (options) => {
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;
    const name = (options as { name?: string }).name;

    await runCommand<BucketCreateResult>(
      runtime,
      "bucket.create",
      options as Record<string, unknown>,
      (context) => runBucketCreate(context, { projectRef, branchName, name }),
      {
        renderHuman: (context, descriptor, result) =>
          renderBucketCreate(context, descriptor, result),
        renderJson: (result) => serializeBucketCreate(result),
      },
    );
  });

  return command;
}

function createBucketDeleteCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("delete"), runtime),
    "bucket.delete",
  );

  command.argument("<bucketId>", "Bucket id");
  addGlobalFlags(command);

  command.action(async (bucketId: string, options) => {
    await runCommand<BucketDeleteResult>(
      runtime,
      "bucket.delete",
      options as Record<string, unknown>,
      (context) => runBucketDelete(context, bucketId),
      {
        renderHuman: (context, descriptor, result) =>
          renderBucketDelete(context, descriptor, result),
        renderJson: (result) => serializeBucketDelete(result),
      },
    );
  });

  return command;
}

function createBucketKeyCommand(runtime: CliRuntime): Command {
  const key = attachCommandDescriptor(
    configureRuntimeCommand(new Command("key"), runtime),
    "bucket.key",
  );

  addCompactGlobalFlags(key);

  key.addCommand(createBucketKeyListCommand(runtime));
  key.addCommand(createBucketKeyCreateCommand(runtime));
  key.addCommand(createBucketKeyDeleteCommand(runtime));

  return key;
}

function createBucketKeyListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "bucket.key.list",
  );

  command.argument("<bucketId>", "Bucket id");
  addGlobalFlags(command);

  command.action(async (bucketId: string, options) => {
    await runCommand<BucketKeyListResult>(
      runtime,
      "bucket.key.list",
      options as Record<string, unknown>,
      (context) => runBucketKeyList(context, bucketId),
      {
        renderHuman: (context, descriptor, result) =>
          renderBucketKeyList(context, descriptor, result),
        renderJson: (result) => serializeBucketKeyList(result),
      },
    );
  });

  return command;
}

function createBucketKeyCreateCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("create"), runtime),
    "bucket.key.create",
  );

  command
    .argument("<bucketId>", "Bucket id")
    .addOption(
      new Option(
        "--role <role>",
        'Access role: "read" or "read_write" (default: read_write)',
      ),
    )
    .addOption(
      new Option(
        "--name <name>",
        "Key display name (auto-generated if omitted)",
      ),
    );
  addGlobalFlags(command);

  command.action(async (bucketId: string, options) => {
    const role = (options as { role?: string }).role;
    const name = (options as { name?: string }).name;

    await runCommand<BucketKeyCreateResult>(
      runtime,
      "bucket.key.create",
      options as Record<string, unknown>,
      (context) => runBucketKeyCreate(context, bucketId, { role, name }),
      {
        renderStdout: (context, descriptor, result) =>
          renderBucketKeyCreateStdout(context, descriptor, result),
        renderHuman: (context, descriptor, result) =>
          renderBucketKeyCreate(context, descriptor, result),
        renderJson: (result) => serializeBucketKeyCreate(result),
      },
    );
  });

  return command;
}

function createBucketKeyDeleteCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("delete"), runtime),
    "bucket.key.delete",
  );

  command.argument("<bucketId>", "Bucket id").argument("<keyId>", "Key id");
  addGlobalFlags(command);

  command.action(async (bucketId: string, keyId: string, options) => {
    await runCommand<BucketKeyDeleteResult>(
      runtime,
      "bucket.key.delete",
      options as Record<string, unknown>,
      (context) => runBucketKeyDelete(context, bucketId, keyId),
      {
        renderHuman: (context, descriptor, result) =>
          renderBucketKeyDelete(context, descriptor, result),
        renderJson: (result) => serializeBucketKeyDelete(result),
      },
    );
  });

  return command;
}
