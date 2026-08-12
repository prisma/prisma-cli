/**
 * The Postgres lifecycle against the real API: create a database in a
 * scratch project, read it back every way the CLI offers, manage its
 * connection strings, then remove it.
 *
 * `connection create` and `connection rotate` answer with a live
 * connection string, so nothing here stringifies a whole envelope — a
 * failed assertion prints its operands, and that would put database
 * credentials into the CI log.
 */
import { expect, it } from "vitest";

import { scratchDatabaseName, scratchName } from "./harness";
import { useScratchProject } from "./scratch";
import { describeCommand } from "./suite";

const scratch = useScratchProject("postgres");

const DATABASE_ID = /^db_/;
const CONNECTION_ID = /^con_/;
const POSTGRES_URL = /^postgres:\/\//;

let databaseId: string | undefined;
let databaseName: string | undefined;
let connectionId: string | undefined;

function requireDatabase(): string {
  if (databaseId === undefined) {
    throw new Error("postgres create did not run or did not report an id");
  }
  return databaseId;
}

function requireConnection(): string {
  if (connectionId === undefined) {
    throw new Error(
      "postgres connection create did not run or did not report an id",
    );
  }
  return connectionId;
}

interface DatabaseRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly region: string;
}

interface ConnectionRow {
  readonly id: string;
  readonly name: string;
  readonly databaseId: string;
}

describeCommand("postgres create", () => {
  it("creates a ready database in the scratch project", async () => {
    const name = scratchDatabaseName("db");
    const run = await scratch.run(["postgres", "create", name]);
    const created = run.envelope.result as {
      readonly projectId: string;
      readonly database: DatabaseRow;
    };

    expect(created.projectId).toBe(scratch.project().id);
    expect(created.database.id).toMatch(DATABASE_ID);
    expect(created.database.name).toBe(name);
    expect(created.database.status).toBe("ready");
    expect(created.database.region).toBeTruthy();
    databaseId = created.database.id;
    databaseName = created.database.name;
  });
});

describeCommand("postgres list", () => {
  it("lists the database that was just created", async () => {
    const run = await scratch.run(["postgres", "list"]);
    const listed = run.envelope.result as {
      readonly projectId: string;
      readonly databases: readonly DatabaseRow[];
      readonly items: readonly unknown[];
      readonly count: number;
    };

    expect(listed.projectId).toBe(scratch.project().id);
    expect(listed.count).toBe(listed.items.length);
    const mine = listed.databases.find((row) => row.id === requireDatabase());
    expect(mine?.name).toBe(databaseName);
  });
});

describeCommand("postgres show", () => {
  it("shows the database and the connections it has", async () => {
    const run = await scratch.run(["postgres", "show", requireDatabase()]);
    const shown = run.envelope.result as {
      readonly database: DatabaseRow;
      readonly connections: readonly ConnectionRow[];
    };

    expect(shown.database.id).toBe(requireDatabase());
    expect(shown.database.name).toBe(databaseName);
    // `postgres create` mints a default connection, so this is never
    // legitimately empty for a database this run just made.
    expect(shown.connections.length).toBeGreaterThan(0);
  });
});

describeCommand("postgres usage", () => {
  it("reports usage for the database over a bounded period", async () => {
    const run = await scratch.run(["postgres", "usage", requireDatabase()]);
    const usage = run.envelope.result as {
      readonly database: DatabaseRow;
      readonly period: { readonly start: string; readonly end: string };
    };

    expect(usage.database.id).toBe(requireDatabase());
    expect(Date.parse(usage.period.start)).not.toBeNaN();
    expect(Date.parse(usage.period.end)).toBeGreaterThan(
      Date.parse(usage.period.start),
    );
  });
});

describeCommand("postgres backup list", () => {
  it("lists backups for the database", async () => {
    const run = await scratch.run([
      "postgres",
      "backup",
      "list",
      requireDatabase(),
    ]);
    const listed = run.envelope.result as {
      readonly items: readonly unknown[];
      readonly count: number;
    };

    // A database minutes old has no backups yet, so this asserts the
    // call answers in the right shape rather than asserting a non-empty
    // list. The count and the rows still have to agree.
    expect(Array.isArray(listed.items)).toBe(true);
    expect(listed.count).toBe(listed.items.length);
  });
});

describeCommand("postgres connection create", () => {
  it("mints a connection string", async () => {
    const name = scratchName("conn");
    const run = await scratch.run([
      "postgres",
      "connection",
      "create",
      requireDatabase(),
      "--name",
      name,
    ]);
    const created = run.envelope.result as {
      readonly connection: ConnectionRow;
      readonly connectionString: string;
    };

    expect(created.connection.id).toMatch(CONNECTION_ID);
    expect(created.connection.name).toBe(name);
    expect(created.connection.databaseId).toBe(requireDatabase());
    // Shape only — the value is a live credential and is never printed.
    expect(created.connectionString).toMatch(POSTGRES_URL);
    connectionId = created.connection.id;
  });
});

describeCommand("postgres connection list", () => {
  it("lists the connection that was just created", async () => {
    const run = await scratch.run([
      "postgres",
      "connection",
      "list",
      requireDatabase(),
    ]);
    const listed = run.envelope.result as {
      readonly connections: readonly ConnectionRow[];
      readonly items: readonly unknown[];
      readonly count: number;
    };

    expect(listed.count).toBe(listed.items.length);
    expect(listed.connections.map((row) => row.id)).toContain(
      requireConnection(),
    );
  });
});

describeCommand("postgres connection rotate", () => {
  it("rotates the connection's secret, keeping the connection", async () => {
    const run = await scratch.run([
      "postgres",
      "connection",
      "rotate",
      requireConnection(),
      "--confirm",
      requireConnection(),
    ]);
    const rotated = run.envelope.result as {
      readonly connection: { readonly id: string };
      readonly connectionString: string;
    };

    // Rotation replaces the secret behind the same connection; a new id
    // would mean it created one instead.
    expect(rotated.connection.id).toBe(requireConnection());
    expect(rotated.connectionString).toMatch(POSTGRES_URL);
  });
});

describeCommand("postgres connection remove", () => {
  it("removes the connection, and the list agrees", async () => {
    const run = await scratch.run([
      "postgres",
      "connection",
      "remove",
      requireConnection(),
      "--confirm",
      requireConnection(),
    ]);
    const removed = run.envelope.result as {
      readonly connection: { readonly id: string };
    };

    expect(removed.connection.id).toBe(requireConnection());

    const after = await scratch.run([
      "postgres",
      "connection",
      "list",
      requireDatabase(),
    ]);
    const listed = after.envelope.result as {
      readonly connections: readonly ConnectionRow[];
    };
    expect(listed.connections.map((row) => row.id)).not.toContain(
      requireConnection(),
    );
  });
});

describeCommand("postgres remove", () => {
  it("removes the database, and the list agrees", async () => {
    const run = await scratch.run([
      "postgres",
      "remove",
      requireDatabase(),
      "--confirm",
      requireDatabase(),
    ]);
    const removed = run.envelope.result as {
      readonly database: { readonly id: string };
    };

    expect(removed.database.id).toBe(requireDatabase());

    const after = await scratch.run(["postgres", "list"]);
    const listed = after.envelope.result as {
      readonly databases: readonly DatabaseRow[];
    };
    expect(listed.databases.map((row) => row.id)).not.toContain(
      requireDatabase(),
    );
  });
});
