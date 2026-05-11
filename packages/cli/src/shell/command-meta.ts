import type { Command } from "commander";

const COMMAND_DESCRIPTOR_ID = Symbol("prisma.commandDescriptorId");

export interface CommandDescriptor {
  id: string;
  path: string[];
  description: string;
  docsPath?: string;
  examples?: string[];
  longDescription?: string;
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
    id: "project",
    path: ["prisma", "project"],
    description: "Manage the link between this directory and a Prisma project",
    examples: ["prisma-cli project list", "prisma-cli project show"],
  },
  {
    id: "app",
    path: ["prisma", "app"],
    description: "Manage apps and deployments for a project",
    examples: [
      "prisma-cli app deploy",
      "prisma-cli app deploy --app hello-world --build-type nextjs --http-port 3000",
    ],
  },
  {
    id: "branch",
    path: ["prisma", "branch"],
    description: "View your active Platform branches",
    examples: ["prisma-cli branch list", "prisma-cli branch show"],
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
    description: "Show the Prisma project linked to this directory",
    examples: ["prisma-cli project show", "prisma-cli project show --json"],
  },
  {
    id: "project.link",
    path: ["prisma", "project", "link"],
    description: "Link this directory to a Prisma project",
    examples: ["prisma-cli project link", "prisma-cli project link proj_123"],
  },
  {
    id: "branch.list",
    path: ["prisma", "branch", "list"],
    description: "List active Platform branches linked to this project",
    examples: ["prisma-cli branch list", "prisma-cli branch list --json"],
  },
  {
    id: "branch.show",
    path: ["prisma", "branch", "show"],
    description: "Show the Platform branch matching your current Git branch",
    examples: ["prisma-cli branch show", "prisma-cli branch show --json"],
  },
  {
    id: "branch.use",
    path: ["prisma", "branch", "use"],
    description: "Change the local default branch context.",
    examples: ["prisma-cli branch use", "prisma-cli branch use production"],
  },
  {
    id: "app.build",
    path: ["prisma", "app", "build"],
    description: "Build the app locally into a deployable artifact",
    examples: ["prisma-cli app build --build-type nextjs", "prisma-cli app build --build-type nuxt", "prisma-cli app build --build-type bun --entry server.ts"],
  },
  {
    id: "app.run",
    path: ["prisma", "app", "run"],
    description: "Run your app locally",
    examples: ["prisma-cli app run --build-type nextjs", "prisma-cli app run --build-type bun --entry server.ts --port 3000"],
  },
  {
    id: "app.deploy",
    path: ["prisma", "app", "deploy"],
    description: "Creates a new deployment for the app",
    examples: [
      "prisma-cli app deploy",
      "prisma-cli app deploy --app hello-world --env DATABASE_URL=postgresql://example",
      "prisma-cli app deploy --app hello-world --build-type nextjs --http-port 3000",
      "prisma-cli app deploy --app hello-world --build-type nuxt",
    ],
  },
  {
    id: "app.update-env",
    path: ["prisma", "app", "update-env"],
    description: "Create a new deployment with updated environment variables.",
    examples: ["prisma-cli app update-env --env DATABASE_URL=postgresql://example", "prisma-cli app update-env --app hello-world --env DATABASE_URL=postgresql://another"],
  },
  {
    id: "app.list-env",
    path: ["prisma", "app", "list-env"],
    description: "List environment variable names for the selected app.",
    examples: ["prisma-cli app list-env", "prisma-cli app list-env --app hello-world"],
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
    id: "app.logs",
    path: ["prisma", "app", "logs"],
    description: "Stream logs for the app's current deployment",
    examples: ["prisma-cli app logs", "prisma-cli app logs --deployment dep_123"],
  },
  {
    id: "app.list-deploys",
    path: ["prisma", "app", "list-deploys"],
    description: "List deployments for the app",
    examples: ["prisma-cli app list-deploys", "prisma-cli app list-deploys --app hello-world"],
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
    description: "Promote a deployment to production by rebuilding with production env vars",
    examples: ["prisma-cli app promote dep_123", "prisma-cli app promote dep_123 --app hello-world"],
  },
  {
    id: "app.rollback",
    path: ["prisma", "app", "rollback"],
    description: "Roll back production to a previous deployment",
    examples: ["prisma-cli app rollback", "prisma-cli app rollback --app hello-world --to dep_123"],
  },
  {
    id: "app.remove",
    path: ["prisma", "app", "remove"],
    description: "Remove the app from the current branch",
    examples: ["prisma-cli app remove --app hello-world", "prisma-cli app remove --app hello-world --yes"],
  },
  {
    id: "app.env",
    path: ["prisma", "app", "env"],
    description: "Manage environment variables for the linked project.",
    docsPath: "docs/product/command-spec.md#prisma-app-env",
    examples: [
      "prisma-cli app env list --class production",
      "prisma-cli app env set STRIPE_KEY=sk_test_xxx --class production",
      "prisma-cli app env unset STRIPE_KEY --branch feature-auth",
    ],
  },
  {
    id: "app.env.set",
    path: ["prisma", "app", "env", "set"],
    description: "Create or replace an environment variable's value.",
    docsPath: "docs/product/command-spec.md#prisma-app-env-set-keyvalue",
    examples: [
      "prisma-cli app env set STRIPE_KEY=sk_test_xxx --class production",
      "prisma-cli app env set STRIPE_KEY=override --branch feature-auth",
    ],
  },
  {
    id: "app.env.list",
    path: ["prisma", "app", "env", "list"],
    description: "List environment variable metadata for a scope (no values).",
    docsPath: "docs/product/command-spec.md#prisma-app-env-list",
    examples: [
      "prisma-cli app env list --class production",
      "prisma-cli app env list --branch feature-auth",
    ],
  },
  {
    id: "app.env.unset",
    path: ["prisma", "app", "env", "unset"],
    description: "Remove an environment variable from a scope.",
    docsPath: "docs/product/command-spec.md#prisma-app-env-unset-key",
    examples: [
      "prisma-cli app env unset STRIPE_KEY --class production",
      "prisma-cli app env unset STRIPE_KEY --branch feature-auth",
    ],
  },
];

const DESCRIPTORS_BY_ID = new Map(DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]));

type DescriptorCommand = Command & {
  [COMMAND_DESCRIPTOR_ID]?: string;
};

export function attachCommandDescriptor<T extends Command>(command: T, descriptorId: string): T {
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
  const descriptor = DESCRIPTORS.find((candidate) => candidate.path.join(" ") === path.join(" "));

  if (!descriptor) {
    throw new Error(`No command descriptor registered for "${path.join(" ")}".`);
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
  return descriptor.path.length === 1 ? descriptor.path[0] : descriptor.path.slice(1).join(" ");
}
