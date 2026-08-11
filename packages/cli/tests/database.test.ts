import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";

import { createTempCwd, executeCli } from "./helpers";

const DATABASE_HELP_ROW =
  /database\s+Manage Prisma Postgres databases for a project/;

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("database commands", () => {
  it("renders database and connection help without aliases or connection show", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const root = await executeCli({
      argv: ["--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const database = await executeCli({
      argv: ["database", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const connection = await executeCli({
      argv: ["database", "connection", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(root.exitCode).toBe(0);
    // The column width flexes with the widest command name, so only the
    // row's presence is asserted, not its exact padding.
    expect(root.stderr).toMatch(DATABASE_HELP_ROW);

    expect(database.exitCode).toBe(0);
    const databaseHelp = stripAnsi(database.stderr).replace(/[ \t]+\n/g, "\n");
    expect(databaseHelp).toMatchInlineSnapshot(`
      "database → Manage Prisma Postgres databases for a project

      │  list                List Prisma Postgres databases for the resolved project
      │  show <database>     Show database metadata without secret values
      │  create <name>       Create a Prisma Postgres database and print its
      │                      one-time connection URL
      │  usage <database>    Show usage metrics for a database
      │  restore <database>  Restore a database from a backup after exact id
      │                      confirmation
      │  remove <database>   Remove a database after exact id confirmation
      │  backup              Inspect platform-created database backups
      │  connection          Manage one-time-view database connection strings
      │
      │  Global options:
      │  --json            Emit structured JSON output.
      │  -q, --quiet       Reduce human-oriented output.
      │  -v, --verbose     Increase human-oriented output detail.
      │  --trace           Show deeper diagnostics for failures.
      │  --no-interactive  Disable interactive behavior and prompts.
      │  -y, --yes         Accept supported confirmation prompts.
      │
      │  Examples:
      │    $ prisma-cli database list
      │    $ prisma-cli database create my-db
      │    $ prisma-cli database connection create db_123
      "
    `);
    expect(databaseHelp).not.toContain("db ");
    expect(databaseHelp).not.toContain("postgres ");

    expect(connection.exitCode).toBe(0);
    const connectionHelp = stripAnsi(connection.stderr).replace(
      /[ \t]+\n/g,
      "\n",
    );
    expect(connectionHelp).toMatchInlineSnapshot(`
      "database connection → Manage one-time-view database connection strings

      │  list <database>      List database connection metadata without secret
      │                       values
      │  create <database>    Create a database connection and print its one-time
      │                       connection URL
      │  rotate <connection>  Rotate connection credentials and print the new
      │                       one-time connection URL
      │  remove <connection>  Remove a database connection after exact id
      │                       confirmation
      │
      │  Global options:
      │  --json            Emit structured JSON output.
      │  -q, --quiet       Reduce human-oriented output.
      │  -v, --verbose     Increase human-oriented output detail.
      │  --trace           Show deeper diagnostics for failures.
      │  --no-interactive  Disable interactive behavior and prompts.
      │  -y, --yes         Accept supported confirmation prompts.
      │
      │  Examples:
      │    $ prisma-cli database connection list db_123
      │    $ prisma-cli database connection create db_123
      │    $ prisma-cli database connection remove conn_123 --confirm conn_123
      "
    `);
    expect(connectionHelp).not.toContain("show");
  });
});
