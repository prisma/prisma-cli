import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";

import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

async function login(cwd: string, stateDir: string) {
  await executeCli({
    argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
    cwd,
    stateDir,
    fixturePath,
  });
}

async function writeLocalPin(cwd: string, projectId = "proj_123") {
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(
    path.join(cwd, ".prisma/local.json"),
    `${JSON.stringify({ workspaceId: "ws_123", projectId }, null, 2)}\n`,
    "utf8",
  );
}

async function setupLinkedProject() {
  const cwd = await createTempCwd();
  const stateDir = path.join(cwd, ".state");
  await login(cwd, stateDir);
  await writeLocalPin(cwd);
  return { cwd, stateDir };
}

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
    expect(root.stderr).toContain(
      "database  Manage Prisma Postgres databases for a project",
    );

    expect(database.exitCode).toBe(0);
    const databaseHelp = stripAnsi(database.stderr).replace(/[ \t]+\n/g, "\n");
    expect(databaseHelp).toMatchInlineSnapshot(`
      "database → Manage Prisma Postgres databases for a project

      │  list               List Prisma Postgres databases for the resolved project
      │  show <database>    Show database metadata without secret values
      │  create <name>      Create a Prisma Postgres database and print its one-time
      │                     connection URL
      │  remove <database>  Remove a database after exact id confirmation
      │  connection         Manage one-time-view database connection strings
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

  it("lists databases with the standard JSON envelope and redacts secrets", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["database", "list", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(payload).toMatchObject({
      ok: true,
      command: "database.list",
      result: {
        context: {
          project: "Acme Dashboard",
        },
        items: [
          { name: "acme-preview", id: "db_123", status: "default" },
          { name: "acme-production", id: "db_456", status: null },
        ],
        count: 2,
        projectId: "proj_123",
      },
      warnings: [],
      nextSteps: [],
      nextActions: [],
    });
    expect(JSON.stringify(payload)).not.toContain(
      "postgresql://secret-preview",
    );
    expect(JSON.stringify(payload)).not.toContain("connectionString");
  });

  it("shows database metadata and connection metadata without secret values", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["database", "show", "db_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result).toMatchObject({
      database: {
        id: "db_123",
        name: "acme-preview",
      },
      connections: [
        {
          id: "conn_123",
          name: "primary",
          databaseId: "db_123",
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain(
      "postgresql://secret-preview",
    );
    expect(JSON.stringify(payload)).not.toContain("connectionString");
  });

  it("prints exactly one raw connection URL when creating a database", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["database", "create", "scratch", "--branch", "preview"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stderr)).toBe(
      "Creating database...\n" +
        '✔ Created database "scratch" in Acme Dashboard / preview.\n' +
        "  The connection URL below is shown once, so save it now.\n" +
        "\n",
    );
    expect(result.stdout).toBe(
      "postgresql://db_1003.example.prisma.io/postgres\n",
    );
    expect(result.stdout).not.toContain("DATABASE_URL=");
    expect(
      `${result.stdout}${result.stderr}`.split("postgresql://db_1003"),
    ).toHaveLength(2);
  });

  it("omits the branch breadcrumb when creating an unscoped database", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["database", "create", "scratch"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stderr)).toContain(
      '✔ Created database "scratch" in Acme Dashboard.\n',
    );
    expect(stripAnsi(result.stderr)).not.toContain("Acme Dashboard /");
    expect(result.stdout).toBe(
      "postgresql://db_1003.example.prisma.io/postgres\n",
    );
  });

  it("prints database create metadata only in verbose human output", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: [
        "database",
        "create",
        "scratch",
        "--branch",
        "preview",
        "--region",
        "eu-central-1",
        "--verbose",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "postgresql://db_1003.example.prisma.io/postgres\n",
    );
    expect(stderr).toContain(
      '✔ Created database "scratch" in Acme Dashboard / preview.\n',
    );
    expect(stderr).toContain("  workspace    Acme Inc\n");
    expect(stderr).toContain("  project      Acme Dashboard\n");
    expect(stderr).toContain("  branch       preview\n");
    expect(stderr).toContain("  database     scratch  (db_1003)\n");
    expect(stderr).toContain("  region       eu-central-1\n");
    expect(stderr).toContain("  status       ready\n");
    expect(stderr).toContain("  connection   primary  (conn_1002)\n");
    expect(stderr).toContain("Local context:");
    expect(stderr).not.toContain("postgresql://db_1003");
  });

  it("prints only the raw connection URL when creating a database quietly", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["database", "create", "scratch", "--branch", "preview", "--quiet"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "postgresql://db_1003.example.prisma.io/postgres\n",
    );
  });

  it("returns the one-time database connection URL once in JSON", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["database", "create", "scratch", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(payload).toMatchObject({
      ok: true,
      command: "database.create",
      result: {
        database: {
          name: "scratch",
        },
        connectionString: "postgresql://db_1003.example.prisma.io/postgres",
      },
    });
    expect(JSON.stringify(payload).split("postgresql://db_1003")).toHaveLength(
      2,
    );
  });

  it("prints exactly one raw connection URL when creating a database connection", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["database", "connection", "create", "db_123"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stderr)).toBe(
      "Creating connection...\n" +
        '✔ Added a connection to "acme-preview" in Acme Dashboard / preview.\n' +
        "  The connection URL below is shown once, so save it now.\n" +
        "\n",
    );
    expect(result.stdout).toBe(
      "postgresql://db_123-3.example.prisma.io/postgres\n",
    );
    expect(result.stdout).not.toContain("DATABASE_URL=");
    expect(stripAnsi(result.stderr)).not.toContain("cli-");
    expect(stripAnsi(result.stderr)).not.toContain("conn_");
    expect(
      `${result.stdout}${result.stderr}`.split("postgresql://db_123-3"),
    ).toHaveLength(2);
  });

  it("prints database connection create metadata only in verbose human output", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: [
        "database",
        "connection",
        "create",
        "db_123",
        "--name",
        "readonly",
        "--verbose",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "postgresql://db_123-3.example.prisma.io/postgres\n",
    );
    expect(stderr).toContain(
      '✔ Added a connection to "acme-preview" in Acme Dashboard / preview.\n',
    );
    expect(stderr).toContain("  workspace    Acme Inc\n");
    expect(stderr).toContain("  project      Acme Dashboard\n");
    expect(stderr).toContain("  branch       preview\n");
    expect(stderr).toContain("  database     acme-preview  (db_123)\n");
    expect(stderr).toContain("  connection   readonly  (conn_1002)\n");
    expect(stderr).toContain("Local context:");
    expect(stderr).not.toContain("postgresql://db_123-3");
  });

  it("prints only the raw connection URL when creating a database connection quietly", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["database", "connection", "create", "db_123", "--quiet"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "postgresql://db_123-3.example.prisma.io/postgres\n",
    );
  });

  it("returns the one-time database connection URL once in JSON", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["database", "connection", "create", "db_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(payload).toMatchObject({
      ok: true,
      command: "database.connection.create",
      result: {
        database: {
          id: "db_123",
        },
        connectionString: "postgresql://db_123-3.example.prisma.io/postgres",
      },
    });
    expect(JSON.stringify(payload).split("postgresql://db_123-3")).toHaveLength(
      2,
    );
  });

  it("requires exact database id confirmation before removal", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const wrongConfirm = await executeCli({
      argv: [
        "database",
        "remove",
        "acme-preview",
        "--confirm",
        "acme-preview",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const wrongPayload = JSON.parse(wrongConfirm.stdout);

    expect(wrongConfirm.exitCode).toBe(2);
    expect(wrongPayload).toMatchObject({
      ok: false,
      command: "database.remove",
      error: {
        code: "CONFIRMATION_REQUIRED",
        domain: "database",
        meta: {
          expectedConfirm: "db_123",
          receivedConfirm: "acme-preview",
        },
      },
    });

    const exactConfirm = await executeCli({
      argv: [
        "database",
        "remove",
        "acme-preview",
        "--confirm",
        "db_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const exactPayload = JSON.parse(exactConfirm.stdout);

    expect(exactConfirm.exitCode).toBe(0);
    expect(exactPayload).toMatchObject({
      ok: true,
      command: "database.remove",
      result: {
        database: {
          id: "db_123",
          name: "acme-preview",
        },
      },
    });
  });

  it("requires exact connection id confirmation before removal", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const wrongConfirm = await executeCli({
      argv: [
        "database",
        "connection",
        "remove",
        "conn_123",
        "--confirm",
        "primary",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const wrongPayload = JSON.parse(wrongConfirm.stdout);

    expect(wrongConfirm.exitCode).toBe(2);
    expect(wrongPayload).toMatchObject({
      ok: false,
      command: "database.connection.remove",
      error: {
        code: "CONFIRMATION_REQUIRED",
        domain: "database",
        meta: {
          expectedConfirm: "conn_123",
          receivedConfirm: "primary",
        },
      },
    });

    const exactConfirm = await executeCli({
      argv: [
        "database",
        "connection",
        "remove",
        "conn_123",
        "--confirm",
        "conn_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const exactPayload = JSON.parse(exactConfirm.stdout);

    expect(exactConfirm.exitCode).toBe(0);
    expect(exactPayload).toMatchObject({
      ok: true,
      command: "database.connection.remove",
      result: {
        connection: {
          id: "conn_123",
        },
      },
    });
  });
});
