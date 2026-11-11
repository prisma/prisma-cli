import {
  type CommandFamily,
  defineCommandFamily,
  type RedirectSpec,
} from "@prisma/cli-engine";
import { CLI_DOCS_URL } from "./cli-name";

function v7Command(
  from: string,
  entry: Omit<RedirectSpec, "from" | "flag" | "code" | "summary">,
): RedirectSpec {
  return {
    from,
    code: "CLI.V7_COMMAND",
    summary: `\`{bin} ${from}\` is a Prisma 7 command and is not available in Prisma 8`,
    ...entry,
  };
}

function v7Flag(
  command: string,
  flag: string,
  entry: Omit<RedirectSpec, "from" | "flag" | "code" | "summary">,
): RedirectSpec {
  return {
    from: command,
    flag,
    code: "CLI.V7_FLAG",
    summary: `\`--${flag.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}\` on \`{bin} ${command}\` is a Prisma 7 flag and is not available in Prisma 8`,
    ...entry,
  };
}

const INIT_SCHEMA_REASON =
  "`init` prepares this repository for Prisma: it writes prisma.config.ts, adds prisma as a dev dependency and installs the AI-agent skills. It sets up no database schema or client; `orm init` does that.";

const INIT_SCHEMA_FLAGS: readonly string[] = [
  "datasourceProvider",
  "generatorProvider",
  "previewFeature",
  "output",
  "url",
  "withModel",
];

export const v7CommandFamily: CommandFamily = defineCommandFamily({
  commands: {},
  redirects: [
    v7Command("bootstrap", {
      replacement: [
        "{bin} project create <name>",
        "{bin} postgres create <name>",
      ],
      help: "project create",
      reason:
        "Setting up a new app takes two commands: `project create` creates a Project, the container for one app's databases and services, and links this directory to it; `postgres create` then adds a Prisma Postgres database to that Project.",
    }),
    v7Command("version", {
      replacement: "{bin} --version",
      reason:
        "`--version` prints only this CLI's version number. It does not report Node.js, operating system or engine details.",
    }),
    v7Command("debug", {
      docsUrl: CLI_DOCS_URL,
      reason:
        "No command prints debugging information about this CLI and its environment.",
    }),
    v7Command("mcp", {
      docsUrl: CLI_DOCS_URL,
      reason:
        "No command starts an MCP (Model Context Protocol) server for AI tools.",
    }),
    v7Command("complete", {
      docsUrl: CLI_DOCS_URL,
      reason:
        "This CLI has no shell completion: no command prints or installs a completion script for your shell.",
    }),
    v7Command("platform status", {
      docsUrl: CLI_DOCS_URL,
      reason:
        "No command reports the status of your Prisma Platform account. The docs list the commands that inspect workspaces, Projects and databases.",
    }),
    v7Command("postgres link", {
      replacement: [
        "{bin} project link",
        "{bin} postgres connection create <database>",
      ],
      help: "postgres connection create",
      reason:
        "Linking and connecting are two commands: `project link` points this directory at an existing Project, so commands run here act on it; `postgres connection create` creates a connection URL for one of its databases. The URL prints once, in that command's output; nothing writes it to a .env file.",
    }),
    v7Flag("init", "db", {
      replacement: "{bin} postgres create <name>",
      help: "postgres create",
      reason:
        "`init` creates no database. `postgres create` creates a Prisma Postgres database in the Project this directory is linked to.",
    }),
    v7Flag("init", "noSkills", {
      replacement: "{bin} init --skills=none",
      help: "init",
      reason:
        "`--skills=none` skips installing the AI-agent skills and records in prisma.config.ts that none are wanted, so later installs do not add them.",
    }),
    ...INIT_SCHEMA_FLAGS.map((flag) =>
      v7Flag("init", flag, {
        replacement: "{bin} orm init",
        help: "orm init",
        reason: INIT_SCHEMA_REASON,
      }),
    ),
  ],
});
