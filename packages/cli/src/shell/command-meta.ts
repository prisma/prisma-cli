import type { Command } from "commander";
import { resolvePrismaCliPackageCommandFormatterSync } from "../lib/agent/cli-command";
import {
  PRISMA_AGENT_INSTALL_ARGS,
  PRISMA_AGENT_STATUS_ARGS,
  PRISMA_AGENT_UPDATE_ARGS,
  PRISMA_COMPUTE_AGENT_SKILL,
} from "../lib/agent/constants";
import type { CliRuntime } from "./runtime";

const COMMAND_DESCRIPTOR_ID = Symbol("prisma.commandDescriptorId");

export interface CommandDescriptor {
  id: string;
  path: string[];
  description: string;
  docsPath?: string;
  examples?: string[] | ((runtime: CliRuntime) => string[]);
  longDescription?: string;
}

function agentCommandExamples(
  runtime: CliRuntime,
  commands: readonly (readonly string[])[],
): string[] {
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(
    runtime.cwd,
  );
  return commands.map((command) => formatCommand(command));
}

const DESCRIPTORS: CommandDescriptor[] = [
  {
    id: "root",
    path: ["prisma"],
    description: "The Prisma Developer Platform, from your terminal",
    examples: ["prisma-cli auth login", "prisma-cli app deploy"],
    longDescription:
      "Deploy your app with isolated infrastructure for every branch",
  },
  {
    id: "version",
    path: ["prisma", "version"],
    description: "Show CLI build and environment",
    examples: ["prisma-cli version", "prisma-cli version --json"],
  },
  {
    id: "init",
    path: ["prisma", "init"],
    description: "Write a committed prisma.compute.ts for this app",
    examples: [
      "prisma-cli init",
      "prisma-cli init --framework hono --entry src/index.ts",
      "prisma-cli init --no-link",
    ],
  },
  {
    id: "agent",
    path: ["prisma", "agent"],
    description: "Install Prisma context for AI coding agents",
    examples: (runtime) =>
      agentCommandExamples(runtime, [
        PRISMA_AGENT_INSTALL_ARGS,
        PRISMA_AGENT_UPDATE_ARGS,
        PRISMA_AGENT_STATUS_ARGS,
      ]),
  },
  {
    id: "agent.install",
    path: ["prisma", "agent", "install"],
    description: "Install Prisma skills for AI coding agents",
    examples: (runtime) =>
      agentCommandExamples(runtime, [
        PRISMA_AGENT_INSTALL_ARGS,
        [...PRISMA_AGENT_INSTALL_ARGS, "--agent", "codex"],
        [...PRISMA_AGENT_INSTALL_ARGS, "--all-agents"],
        [...PRISMA_AGENT_INSTALL_ARGS, "--skill", PRISMA_COMPUTE_AGENT_SKILL],
      ]),
  },
  {
    id: "agent.update",
    path: ["prisma", "agent", "update"],
    description: "Refresh Prisma skills for AI coding agents",
    examples: (runtime) =>
      agentCommandExamples(runtime, [
        PRISMA_AGENT_UPDATE_ARGS,
        [...PRISMA_AGENT_UPDATE_ARGS, "--agent", "codex"],
        [...PRISMA_AGENT_UPDATE_ARGS, "--all-agents"],
      ]),
  },
  {
    id: "agent.status",
    path: ["prisma", "agent", "status"],
    description: "Show installed Prisma skills",
    examples: (runtime) =>
      agentCommandExamples(runtime, [
        PRISMA_AGENT_STATUS_ARGS,
        [...PRISMA_AGENT_STATUS_ARGS, "--json"],
        [...PRISMA_AGENT_STATUS_ARGS, "--global"],
      ]),
  },
  {
    id: "auth",
    path: ["prisma", "auth"],
    description: "Manage local authentication for the CLI",
    examples: ["prisma-cli auth login", "prisma-cli auth whoami"],
  },
  {
    id: "auth.login",
    path: ["prisma", "auth", "login"],
    description: "Log in to your Prisma platform account",
    examples: ["prisma-cli auth login"],
  },
  {
    id: "auth.logout",
    path: ["prisma", "auth", "logout"],
    description: "Clear stored authentication credentials",
    examples: ["prisma-cli auth logout"],
  },
  {
    id: "auth.whoami",
    path: ["prisma", "auth", "whoami"],
    description: "Show the authenticated user and accessible workspace",
    examples: ["prisma-cli auth whoami", "prisma-cli auth whoami --json"],
  },
  {
    id: "auth.workspace",
    path: ["prisma", "auth", "workspace"],
    description: "Manage local authenticated workspaces",
    examples: [
      "prisma-cli auth workspace list",
      "prisma-cli auth workspace use",
      "prisma-cli auth workspace use wksp_123",
      "prisma-cli auth workspace logout wksp_123",
    ],
  },
  {
    id: "auth.workspace.list",
    path: ["prisma", "auth", "workspace", "list"],
    description: "List locally authenticated workspaces",
    examples: [
      "prisma-cli auth workspace list",
      "prisma-cli auth workspace list --json",
    ],
  },
  {
    id: "auth.workspace.use",
    path: ["prisma", "auth", "workspace", "use"],
    description: "Switch the local CLI workspace",
    examples: [
      "prisma-cli auth workspace use",
      "prisma-cli auth workspace use wksp_123",
      'prisma-cli auth workspace use "Acme Inc"',
    ],
  },
  {
    id: "auth.workspace.logout",
    path: ["prisma", "auth", "workspace", "logout"],
    description: "Remove one local OAuth workspace session",
    examples: [
      "prisma-cli auth workspace logout wksp_123",
      'prisma-cli auth workspace logout "Acme Inc"',
    ],
  },
  {
    id: "project",
    path: ["prisma", "project"],
    description: "Manage and inspect your Prisma projects",
    examples: [
      "prisma-cli project list",
      "prisma-cli project link proj_123",
      "prisma-cli project create my-app",
    ],
  },
  {
    id: "app",
    path: ["prisma", "app"],
    description: "Manage apps and deployments for a project",
    examples: [
      "prisma-cli app deploy",
      "prisma-cli app deploy --app my-app --framework nextjs --http-port 3000",
    ],
  },
  {
    id: "branch",
    path: ["prisma", "branch"],
    description: "View your Platform branches",
    examples: ["prisma-cli branch list"],
  },
  {
    id: "build",
    path: ["prisma", "build"],
    description: "Inspect builds",
    examples: ["prisma-cli build logs <build_id>"],
  },
  {
    id: "build.logs",
    path: ["prisma", "build", "logs"],
    description: "Stream the logs for a build",
    examples: [
      "prisma-cli build logs <build_id>",
      "prisma-cli build logs <build_id> --follow",
    ],
  },
  {
    id: "database",
    path: ["prisma", "database"],
    description: "Manage Prisma Postgres databases for a project",
    examples: [
      "prisma-cli database list",
      "prisma-cli database create my-db",
      "prisma-cli database connection create db_123",
    ],
  },
  {
    id: "git",
    path: ["prisma", "git"],
    description: "Manage Git repository connections for a project",
    examples: ["prisma-cli git connect", "prisma-cli git disconnect"],
  },
  {
    id: "project.list",
    path: ["prisma", "project", "list"],
    description: "List all projects in your workspace",
    examples: ["prisma-cli project list", "prisma-cli project list --json"],
  },
  {
    id: "project.show",
    path: ["prisma", "project", "show"],
    description: "Show this directory's Project binding",
    examples: [
      "prisma-cli project show",
      "prisma-cli project show --project proj_123 --json",
    ],
  },
  {
    id: "project.create",
    path: ["prisma", "project", "create"],
    description: "Create a Project and link this directory",
    examples: [
      "prisma-cli project create my-app",
      "prisma-cli project create my-app --json",
    ],
  },
  {
    id: "project.link",
    path: ["prisma", "project", "link"],
    description: "Link this directory to a Project",
    examples: [
      "prisma-cli project link",
      "prisma-cli project link proj_123",
      'prisma-cli project link "Acme Dashboard" --json',
    ],
  },
  {
    id: "project.rename",
    path: ["prisma", "project", "rename"],
    description: "Rename the resolved Project",
    examples: [
      'prisma-cli project rename "Acme Dashboard v2"',
      "prisma-cli project rename billing-api --project proj_123",
    ],
  },
  {
    id: "project.remove",
    path: ["prisma", "project", "remove"],
    description: "Remove a Project permanently after exact id confirmation",
    examples: ["prisma-cli project remove proj_123 --confirm proj_123"],
  },
  {
    id: "project.transfer",
    path: ["prisma", "project", "transfer"],
    description:
      "Transfer a Project to another workspace after exact id confirmation",
    examples: [
      'prisma-cli project transfer proj_123 --to-workspace "Prisma Labs" --confirm proj_123',
      "prisma-cli project transfer proj_123 --recipient-token <token> --confirm proj_123",
    ],
  },
  {
    id: "git.connect",
    path: ["prisma", "git", "connect"],
    description: "Connect the resolved project to a GitHub repository",
    examples: [
      "prisma-cli git connect",
      "prisma-cli git connect git@github.com:prisma/prisma-cli.git",
      "prisma-cli git connect --project proj_123",
    ],
  },
  {
    id: "git.disconnect",
    path: ["prisma", "git", "disconnect"],
    description: "Disconnect the GitHub repository from the resolved project",
    examples: [
      "prisma-cli git disconnect",
      "prisma-cli git disconnect --project proj_123",
    ],
  },
  {
    id: "branch.list",
    path: ["prisma", "branch", "list"],
    description: "List Platform branches for the resolved project",
    examples: ["prisma-cli branch list", "prisma-cli branch list --json"],
  },
  {
    id: "database.list",
    path: ["prisma", "database", "list"],
    description: "List Prisma Postgres databases for the resolved project",
    examples: [
      "prisma-cli database list",
      "prisma-cli database list --branch feature/foo",
      "prisma-cli database list --json",
    ],
  },
  {
    id: "database.show",
    path: ["prisma", "database", "show"],
    description: "Show database metadata without secret values",
    examples: [
      "prisma-cli database show db_123",
      "prisma-cli database show acme-preview --branch preview --json",
    ],
  },
  {
    id: "database.create",
    path: ["prisma", "database", "create"],
    description:
      "Create a Prisma Postgres database and print its one-time connection URL",
    examples: [
      "prisma-cli database create my-db",
      "prisma-cli database create my-db --branch feature/foo --region eu-central-1",
    ],
  },
  {
    id: "database.usage",
    path: ["prisma", "database", "usage"],
    description: "Show usage metrics for a database",
    examples: [
      "prisma-cli database usage db_123",
      "prisma-cli database usage acme-production --from 2026-06-01 --to 2026-06-30",
    ],
  },
  {
    id: "database.restore",
    path: ["prisma", "database", "restore"],
    description: "Restore a database from a backup after exact id confirmation",
    examples: [
      "prisma-cli database restore db_123 --backup bkp_456 --confirm db_123",
    ],
  },
  {
    id: "database.remove",
    path: ["prisma", "database", "remove"],
    description: "Remove a database after exact id confirmation",
    examples: ["prisma-cli database remove db_123 --confirm db_123"],
  },
  {
    id: "database.backup",
    path: ["prisma", "database", "backup"],
    description: "Inspect platform-created database backups",
    examples: ["prisma-cli database backup list db_123"],
  },
  {
    id: "database.backup.list",
    path: ["prisma", "database", "backup", "list"],
    description: "List backups for a database",
    examples: [
      "prisma-cli database backup list db_123",
      "prisma-cli database backup list acme-production --limit 50",
    ],
  },
  {
    id: "database.connection",
    path: ["prisma", "database", "connection"],
    description: "Manage one-time-view database connection strings",
    examples: [
      "prisma-cli database connection list db_123",
      "prisma-cli database connection create db_123",
      "prisma-cli database connection remove conn_123 --confirm conn_123",
    ],
  },
  {
    id: "database.connection.list",
    path: ["prisma", "database", "connection", "list"],
    description: "List database connection metadata without secret values",
    examples: [
      "prisma-cli database connection list db_123",
      "prisma-cli database connection list acme-preview --branch preview --json",
    ],
  },
  {
    id: "database.connection.create",
    path: ["prisma", "database", "connection", "create"],
    description:
      "Create a database connection and print its one-time connection URL",
    examples: [
      "prisma-cli database connection create db_123",
      "prisma-cli database connection create db_123 --name readonly",
    ],
  },
  {
    id: "database.connection.rotate",
    path: ["prisma", "database", "connection", "rotate"],
    description:
      "Rotate connection credentials and print the new one-time connection URL",
    examples: [
      "prisma-cli database connection rotate conn_123 --confirm conn_123",
    ],
  },
  {
    id: "database.connection.remove",
    path: ["prisma", "database", "connection", "remove"],
    description: "Remove a database connection after exact id confirmation",
    examples: [
      "prisma-cli database connection remove conn_123 --confirm conn_123",
    ],
  },
  {
    id: "app.build",
    path: ["prisma", "app", "build"],
    description: "Build the app locally into a deployable artifact",
    examples: [
      "prisma-cli app build --build-type nextjs",
      "prisma-cli app build --build-type nuxt",
      "prisma-cli app build --build-type bun --entry server.ts",
    ],
  },
  {
    id: "app.run",
    path: ["prisma", "app", "run"],
    description: "Run your app locally",
    examples: [
      "prisma-cli app run --build-type nextjs",
      "prisma-cli app run --build-type bun --entry server.ts --port 3000",
    ],
  },
  {
    id: "app.deploy",
    path: ["prisma", "app", "deploy"],
    description: "Creates a new deployment for the app",
    examples: [
      "prisma-cli app deploy",
      "prisma-cli app deploy --project proj_123",
      "prisma-cli app deploy --create-project my-app --yes",
      "prisma-cli app deploy --app my-app --env DATABASE_URL=postgresql://example",
      "prisma-cli app deploy --env .env",
      "prisma-cli app deploy --db",
      "prisma-cli app deploy --db --yes",
      "prisma-cli app deploy --app my-app --framework nextjs --http-port 3000",
      "prisma-cli app deploy --app my-app --region us-west-1",
      "prisma-cli app deploy --branch feat-login --framework hono",
      "prisma-cli app deploy --prod --yes",
      "prisma-cli app deploy --framework bun --entry src/server.ts",
    ],
  },
  {
    id: "app.show",
    path: ["prisma", "app", "show"],
    description: "Show the app and its current deployment",
    examples: ["prisma-cli app show", "prisma-cli app show --app hello-world"],
  },
  {
    id: "app.open",
    path: ["prisma", "app", "open"],
    description: "Open the app's live URL",
    examples: ["prisma-cli app open", "prisma-cli app open --app hello-world"],
  },
  {
    id: "app.domain",
    path: ["prisma", "app", "domain"],
    description: "Manage custom domains for an app",
    examples: [
      "prisma-cli app domain add shop.acme.com",
      "prisma-cli app domain wait shop.acme.com --timeout 15m",
      "prisma-cli app domain retry shop.acme.com",
    ],
  },
  {
    id: "app.domain.add",
    path: ["prisma", "app", "domain", "add"],
    description: "Register a custom domain on the app's production branch",
    examples: ["prisma-cli app domain add shop.acme.com"],
  },
  {
    id: "app.domain.show",
    path: ["prisma", "app", "domain", "show"],
    description: "Show custom domain status and certificate details",
    examples: ["prisma-cli app domain show shop.acme.com"],
  },
  {
    id: "app.domain.remove",
    path: ["prisma", "app", "domain", "remove"],
    description: "Detach a custom domain from the app",
    examples: ["prisma-cli app domain remove shop.acme.com --yes"],
  },
  {
    id: "app.domain.retry",
    path: ["prisma", "app", "domain", "retry"],
    description: "Retry custom domain DNS verification and TLS provisioning",
    examples: ["prisma-cli app domain retry shop.acme.com"],
  },
  {
    id: "app.domain.wait",
    path: ["prisma", "app", "domain", "wait"],
    description: "Wait until a custom domain is active or failed",
    examples: [
      "prisma-cli app domain wait shop.acme.com",
      "prisma-cli app domain wait shop.acme.com --timeout 0 --json",
    ],
  },
  {
    id: "app.logs",
    path: ["prisma", "app", "logs"],
    description: "Stream logs for the app's current deployment",
    examples: [
      "prisma-cli app logs",
      "prisma-cli app logs --deployment dep_123",
    ],
  },
  {
    id: "app.list-deploys",
    path: ["prisma", "app", "list-deploys"],
    description: "List deployments for the app",
    examples: [
      "prisma-cli app list-deploys",
      "prisma-cli app list-deploys --app hello-world",
    ],
  },
  {
    id: "app.show-deploy",
    path: ["prisma", "app", "show-deploy"],
    description: "Show a deployment in detail",
    examples: ["prisma-cli app show-deploy dep_123"],
  },
  {
    id: "app.promote",
    path: ["prisma", "app", "promote"],
    description:
      "Promote a deployment to production by rebuilding with production env vars",
    examples: [
      "prisma-cli app promote dep_123",
      "prisma-cli app promote dep_123 --app hello-world",
    ],
  },
  {
    id: "app.rollback",
    path: ["prisma", "app", "rollback"],
    description: "Roll back production to a previous deployment",
    examples: [
      "prisma-cli app rollback",
      "prisma-cli app rollback --app hello-world --to dep_123",
    ],
  },
  {
    id: "app.remove",
    path: ["prisma", "app", "remove"],
    description: "Remove the app from the current branch",
    examples: [
      "prisma-cli app remove --app hello-world",
      "prisma-cli app remove --app hello-world --yes",
    ],
  },
  {
    id: "project.env",
    path: ["prisma", "project", "env"],
    description: "Manage environment variables for the active project",
    examples: [
      "prisma-cli project env list",
      "prisma-cli project env add STRIPE_KEY=sk_test_xxx --role production",
      "prisma-cli project env add --file .env --role preview",
      "prisma-cli project env add DATABASE_URL=postgresql://branch --branch feature/foo",
      "prisma-cli project env remove STRIPE_KEY --role preview",
    ],
  },
  {
    id: "project.env.add",
    path: ["prisma", "project", "env", "add"],
    description: "Create a new environment variable.",
    examples: [
      "prisma-cli project env add STRIPE_KEY=sk_test_xxx --role production",
      "prisma-cli project env add STRIPE_KEY=sk_test_xxx --role preview",
      "prisma-cli project env add --file .env --role preview",
      "prisma-cli project env add DATABASE_URL=postgresql://branch --branch feature/foo",
      "prisma-cli project env add --file .env.local --branch feature/foo",
      "API_URL=https://api.example prisma-cli project env add API_URL --project proj_123 --role preview",
    ],
  },
  {
    id: "project.env.update",
    path: ["prisma", "project", "env", "update"],
    description: "Replace an existing environment variable's value.",
    examples: [
      "prisma-cli project env update STRIPE_KEY=sk_new_xxx --role production",
      "prisma-cli project env update STRIPE_KEY=sk_new_xxx --role preview",
      "prisma-cli project env update --file .env --role production",
      "prisma-cli project env update DATABASE_URL=postgresql://branch --branch feature/foo",
    ],
  },
  {
    id: "project.env.list",
    path: ["prisma", "project", "env", "list"],
    description: "List environment variable metadata for a scope (no values).",
    examples: [
      "prisma-cli project env list",
      "prisma-cli project env list --role production",
      "prisma-cli project env list --role preview",
      "prisma-cli project env list --branch feature/foo",
    ],
  },
  {
    id: "project.env.remove",
    path: ["prisma", "project", "env", "remove"],
    description: "Remove an environment variable from a scope.",
    examples: [
      "prisma-cli project env remove STRIPE_KEY --role production",
      "prisma-cli project env remove STRIPE_KEY --role preview",
      "prisma-cli project env remove DATABASE_URL --branch feature/foo",
    ],
  },
];

const DESCRIPTORS_BY_ID = new Map(
  DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

type DescriptorCommand = Command & {
  [COMMAND_DESCRIPTOR_ID]?: string;
};

export function attachCommandDescriptor<T extends Command>(
  command: T,
  descriptorId: string,
): T {
  const descriptor = getCommandDescriptor(descriptorId);
  (command as DescriptorCommand)[COMMAND_DESCRIPTOR_ID] = descriptor.id;
  command.description(descriptor.description);
  return command;
}

export function getCommandDescriptor(id: string): CommandDescriptor {
  const descriptor = DESCRIPTORS_BY_ID.get(id);

  if (!descriptor) {
    throw new Error(`Unknown command descriptor "${id}".`);
  }

  return descriptor;
}

export function getDescriptorForCommand(command: Command): CommandDescriptor {
  const descriptorId = (command as DescriptorCommand)[COMMAND_DESCRIPTOR_ID];

  if (descriptorId) {
    return getCommandDescriptor(descriptorId);
  }

  const path = getCommandPath(command);
  const descriptor = DESCRIPTORS.find(
    (candidate) => candidate.path.join(" ") === path.join(" "),
  );

  if (!descriptor) {
    throw new Error(
      `No command descriptor registered for "${path.join(" ")}".`,
    );
  }

  return descriptor;
}

export function getCommandPath(command: Command): string[] {
  const names: string[] = [];
  let current: Command | null = command;

  while (current) {
    if (current.name()) {
      names.unshift(current.name());
    }

    current = current.parent ?? null;
  }

  return names;
}

export function formatDescriptorLabel(descriptor: CommandDescriptor): string {
  return descriptor.path.length === 1
    ? descriptor.path[0]
    : descriptor.path.slice(1).join(" ");
}
