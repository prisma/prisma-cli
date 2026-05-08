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
    description: "Unified Prisma CLI.",
    docsPath: "docs/product/command-principles.md",
    examples: ["prisma auth login", "prisma project list"],
    longDescription:
      "The Prisma CLI groups commands by developer workflow and keeps human and agent behavior aligned.",
  },
  {
    id: "auth",
    path: ["prisma", "auth"],
    description: "Authentication and identity commands.",
    docsPath: "docs/product/command-spec.md#prisma-auth-login",
    examples: ["prisma auth login", "prisma auth whoami"],
  },
  {
    id: "auth.login",
    path: ["prisma", "auth", "login"],
    description: "Start an authenticated CLI session.",
    docsPath: "docs/product/command-spec.md#prisma-auth-login",
    examples: ["prisma auth login"],
  },
  {
    id: "auth.logout",
    path: ["prisma", "auth", "logout"],
    description: "Clear the current CLI session.",
    docsPath: "docs/product/command-spec.md#prisma-auth-logout",
    examples: ["prisma auth logout"],
  },
  {
    id: "auth.whoami",
    path: ["prisma", "auth", "whoami"],
    description: "Show the current authenticated identity.",
    docsPath: "docs/product/command-spec.md#prisma-auth-whoami",
    examples: ["prisma auth whoami", "prisma auth whoami --json"],
  },
  {
    id: "project",
    path: ["prisma", "project"],
    description: "Project discovery and repo linking commands.",
    docsPath: "docs/product/command-spec.md#prisma-project-list",
    examples: ["prisma project list", "prisma project show"],
  },
  {
    id: "app",
    path: ["prisma", "app"],
    description: "App deployment and release commands.",
    docsPath: "docs/product/command-spec.md#prisma-app-deploy---app-name---entry-path---build-type-autobunnextjsnuxtastrotanstack-start---http-port-port---env-namevalue",
    examples: [
      "prisma app build --build-type nextjs",
      "prisma app deploy --app hello-world --build-type nextjs --http-port 3000",
      "prisma app deploy --app hello-world --build-type nuxt",
    ],
  },
  {
    id: "branch",
    path: ["prisma", "branch"],
    description: "Branch context and safety commands.",
    docsPath: "docs/product/command-spec.md#prisma-branch-list",
    examples: ["prisma branch list", "prisma branch use production"],
  },
  {
    id: "project.list",
    path: ["prisma", "project", "list"],
    description: "List projects for the authenticated workspace.",
    docsPath: "docs/product/command-spec.md#prisma-project-list",
    examples: ["prisma project list", "prisma project list --json"],
  },
  {
    id: "project.show",
    path: ["prisma", "project", "show"],
    description: "Show the linked project for the current repo.",
    docsPath: "docs/product/command-spec.md#prisma-project-show",
    examples: ["prisma project show", "prisma project show --json"],
  },
  {
    id: "project.link",
    path: ["prisma", "project", "link"],
    description: "Link the current repo to an existing project.",
    docsPath: "docs/product/command-spec.md#prisma-project-link-project",
    examples: ["prisma project link", "prisma project link proj_123"],
  },
  {
    id: "branch.list",
    path: ["prisma", "branch", "list"],
    description: "List branches for the linked project.",
    docsPath: "docs/product/command-spec.md#prisma-branch-list",
    examples: ["prisma branch list", "prisma branch list --json"],
  },
  {
    id: "branch.show",
    path: ["prisma", "branch", "show"],
    description: "Show the current active branch context.",
    docsPath: "docs/product/command-spec.md#prisma-branch-show",
    examples: ["prisma branch show", "prisma branch show --json"],
  },
  {
    id: "branch.use",
    path: ["prisma", "branch", "use"],
    description: "Change the local default branch context.",
    docsPath: "docs/product/command-spec.md#prisma-branch-use-name",
    examples: ["prisma branch use", "prisma branch use production"],
  },
  {
    id: "app.build",
    path: ["prisma", "app", "build"],
    description: "Build the local app into a deployable artifact.",
    docsPath: "docs/product/command-spec.md#prisma-app-build---entry-path---build-type-autobunnextjsnuxtastrotanstack-start",
    examples: ["prisma app build --build-type nextjs", "prisma app build --build-type nuxt", "prisma app build --build-type bun --entry server.ts"],
  },
  {
    id: "app.run",
    path: ["prisma", "app", "run"],
    description: "Start a local framework dev server.",
    docsPath: "docs/product/command-spec.md#prisma-app-run---entry-path---build-type-autobunnextjs---port-port",
    examples: ["prisma app run --build-type nextjs", "prisma app run --build-type bun --entry server.ts --port 3000"],
  },
  {
    id: "app.deploy",
    path: ["prisma", "app", "deploy"],
    description: "Build and release the selected app.",
    docsPath: "docs/product/command-spec.md#prisma-app-deploy---app-name---entry-path---build-type-autobunnextjsnuxtastrotanstack-start---http-port-port---env-namevalue",
    examples: [
      "prisma app deploy",
      "prisma app deploy --app hello-world --env DATABASE_URL=postgresql://example",
      "prisma app deploy --app hello-world --build-type nextjs --http-port 3000",
      "prisma app deploy --app hello-world --build-type nuxt",
    ],
  },
  {
    id: "app.update-env",
    path: ["prisma", "app", "update-env"],
    description: "Create a new deployment with updated environment variables.",
    docsPath: "docs/product/command-spec.md#prisma-app-update-env---app-name---env-namevalue",
    examples: ["prisma app update-env --env DATABASE_URL=postgresql://example", "prisma app update-env --app hello-world --env DATABASE_URL=postgresql://another"],
  },
  {
    id: "app.list-env",
    path: ["prisma", "app", "list-env"],
    description: "List environment variable names for the selected app.",
    docsPath: "docs/product/command-spec.md#prisma-app-list-env---app-name",
    examples: ["prisma app list-env", "prisma app list-env --app hello-world"],
  },
  {
    id: "app.show",
    path: ["prisma", "app", "show"],
    description: "Show the current state of the selected app.",
    docsPath: "docs/product/command-spec.md#prisma-app-show---app-name",
    examples: ["prisma app show", "prisma app show --app hello-world"],
  },
  {
    id: "app.open",
    path: ["prisma", "app", "open"],
    description: "Open the live URL for the selected app.",
    docsPath: "docs/product/command-spec.md#prisma-app-open---app-name",
    examples: ["prisma app open", "prisma app open --app hello-world"],
  },
  {
    id: "app.logs",
    path: ["prisma", "app", "logs"],
    description: "Show or stream logs for a deployment.",
    docsPath: "docs/product/command-spec.md#prisma-app-logs---app-name---deployment-id",
    examples: ["prisma app logs", "prisma app logs --deployment dep_123"],
  },
  {
    id: "app.list-deploys",
    path: ["prisma", "app", "list-deploys"],
    description: "List deployments for the selected app.",
    docsPath: "docs/product/command-spec.md#prisma-app-list-deploys---app-name",
    examples: ["prisma app list-deploys", "prisma app list-deploys --app hello-world"],
  },
  {
    id: "app.show-deploy",
    path: ["prisma", "app", "show-deploy"],
    description: "Show one deployment in detail.",
    docsPath: "docs/product/command-spec.md#prisma-app-show-deploy-deployment",
    examples: ["prisma app show-deploy dep_123"],
  },
  {
    id: "app.promote",
    path: ["prisma", "app", "promote"],
    description: "Switch the live deployment for the selected app.",
    docsPath: "docs/product/command-spec.md#prisma-app-promote-deployment---app-name",
    examples: ["prisma app promote dep_123", "prisma app promote dep_123 --app hello-world"],
  },
  {
    id: "app.rollback",
    path: ["prisma", "app", "rollback"],
    description: "Restore the selected app to an earlier deployment.",
    docsPath: "docs/product/command-spec.md#prisma-app-rollback---app-name---to-deployment",
    examples: ["prisma app rollback", "prisma app rollback --app hello-world --to dep_123"],
  },
  {
    id: "app.remove",
    path: ["prisma", "app", "remove"],
    description: "Remove the selected app from the linked project.",
    docsPath: "docs/product/command-spec.md#prisma-app-remove---app-name--y---yes",
    examples: ["prisma app remove --app hello-world", "prisma app remove --app hello-world --yes"],
  },
  {
    id: "app.env",
    path: ["prisma", "app", "env"],
    description: "Manage environment variables for the linked project.",
    docsPath: "docs/product/command-spec.md#prisma-app-env",
    examples: [
      "prisma app env list --class production",
      "prisma app env set STRIPE_KEY=sk_test_xxx --class production",
      "prisma app env unset STRIPE_KEY --branch feature-auth",
    ],
  },
  {
    id: "app.env.set",
    path: ["prisma", "app", "env", "set"],
    description: "Create or replace an environment variable's value.",
    docsPath: "docs/product/command-spec.md#prisma-app-env-set-keyvalue",
    examples: [
      "prisma app env set STRIPE_KEY=sk_test_xxx --class production",
      "prisma app env set STRIPE_KEY=override --branch feature-auth",
    ],
  },
  {
    id: "app.env.list",
    path: ["prisma", "app", "env", "list"],
    description: "List environment variable metadata for a scope (no values).",
    docsPath: "docs/product/command-spec.md#prisma-app-env-list",
    examples: [
      "prisma app env list --class production",
      "prisma app env list --branch feature-auth",
    ],
  },
  {
    id: "app.env.unset",
    path: ["prisma", "app", "env", "unset"],
    description: "Remove an environment variable from a scope.",
    docsPath: "docs/product/command-spec.md#prisma-app-env-unset-key",
    examples: [
      "prisma app env unset STRIPE_KEY --class production",
      "prisma app env unset STRIPE_KEY --branch feature-auth",
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
