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
    id: "version",
    path: ["prisma", "version"],
    description: "Show CLI build and environment",
    examples: ["prisma-cli version", "prisma-cli version --json"],
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
    description: "Manage and inspect your Prisma projects",
    examples: ["prisma-cli project list", "prisma-cli project link proj_123", "prisma-cli project create my-app"],
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
    description: "View your active Platform branches",
    examples: ["prisma-cli branch list", "prisma-cli branch show"],
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
    examples: ["prisma-cli project show", "prisma-cli project show --project proj_123 --json"],
  },
  {
    id: "project.create",
    path: ["prisma", "project", "create"],
    description: "Create a Project and link this directory",
    examples: ["prisma-cli project create my-app", "prisma-cli project create my-app --json"],
  },
  {
    id: "project.link",
    path: ["prisma", "project", "link"],
    description: "Link this directory to an existing Project",
    examples: ["prisma-cli project link proj_123", "prisma-cli project link \"Acme Dashboard\" --json"],
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
    examples: ["prisma-cli git disconnect", "prisma-cli git disconnect --project proj_123"],
  },
  {
    id: "branch.list",
    path: ["prisma", "branch", "list"],
    description: "List active Platform branches for the resolved project",
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
    longDescription:
      "Agent skills for guided Next.js deploys are available from the Prisma CLI skill cluster.",
    examples: [
      "prisma-cli app deploy",
      "prisma-cli app deploy --project proj_123",
      "prisma-cli app deploy --create-project my-app --yes",
      "prisma-cli app deploy --app my-app --env DATABASE_URL=postgresql://example",
      "prisma-cli app deploy --app my-app --framework nextjs --http-port 3000",
      "prisma-cli app deploy --branch feat-login --framework hono",
      "pnpm dlx skills@latest add prisma/prisma-cli/skills#cli-v<cli-version> --all",
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
    examples: ["prisma-cli app domain wait shop.acme.com", "prisma-cli app domain wait shop.acme.com --timeout 0 --json"],
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
    id: "project.env",
    path: ["prisma", "project", "env"],
    description: "Manage environment variables for the active project",
    examples: [
      "prisma-cli project env list --role production",
      "prisma-cli project env add STRIPE_KEY=sk_test_xxx --role production",
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
      "prisma-cli project env add DATABASE_URL=postgresql://branch --branch feature/foo",
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
      "prisma-cli project env update DATABASE_URL=postgresql://branch --branch feature/foo",
    ],
  },
  {
    id: "project.env.list",
    path: ["prisma", "project", "env", "list"],
    description: "List environment variable metadata for a scope (no values).",
    examples: [
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
