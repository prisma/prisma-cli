/**
 * The Postgres lifecycle against the real API: create a database in a
 * scratch project, read it back every way the CLI offers, manage its
 * connection strings, then remove it.
 */
import { expect, it } from "vitest";

import { scratchName } from "./harness";
import { useScratchProject } from "./scratch";
import { describeCommand } from "./suite";

const scratch = useScratchProject("postgres");

const DATABASE_ID = /^db_/;

/** Set by `postgres create` and read by everything after it. */
let databaseId: string | undefined;
let connectionId: string | undefined;

function requireDatabase(): string {
  if (databaseId === undefined) {
    throw new Error("postgres create did not run or did not report an id");
  }
  return databaseId;
}

describeCommand("postgres create", () => {
  it("creates a database in the scratch project", async () => {
    const run = await scratch.run([
      "postgres",
      "create",
      scratchName("db").replaceAll("-", "_"),
    ]);
    const created = run.envelope.result as {
      readonly database: { readonly id: string; readonly name: string };
    };

    expect(created.database.id).toMatch(DATABASE_ID);
    databaseId = created.database.id;
  });
});

describeCommand("postgres list", () => {
  it("lists the database that was just created", async () => {
    const run = await scratch.run(["postgres", "list"]);
    const listed = run.envelope.result as {
      readonly items: ReadonlyArray<{ readonly id: string }>;
    };

    expect(listed.items.map((item) => item.id)).toContain(requireDatabase());
  });
});

describeCommand("postgres show", () => {
  it("shows the database by id", async () => {
    const run = await scratch.run(["postgres", "show", requireDatabase()]);

    expect(run.envelope.ok).toBe(true);
    expect(JSON.stringify(run.envelope.result)).toContain(requireDatabase());
  });
});

describeCommand("postgres usage", () => {
  it("reports usage for the database", async () => {
    const run = await scratch.run(["postgres", "usage", requireDatabase()]);

    expect(run.envelope.ok).toBe(true);
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

    // A database minutes old has no backups yet, so this asserts the
    // call succeeds and answers in the right shape rather than
    // asserting a non-empty list.
    expect(run.envelope.ok).toBe(true);
    const listed = run.envelope.result as { readonly items?: unknown };
    expect(Array.isArray(listed.items)).toBe(true);
  });
});

describeCommand("postgres connection create", () => {
  it("mints a connection string", async () => {
    const run = await scratch.run([
      "postgres",
      "connection",
      "create",
      requireDatabase(),
      "--name",
      scratchName("conn"),
    ]);
    const created = run.envelope.result as {
      readonly connection: { readonly id: string };
    };

    expect(created.connection.id).toBeTruthy();
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

    expect(run.envelope.ok).toBe(true);
    expect(JSON.stringify(run.envelope.result)).toContain(connectionId ?? "");
  });
});

describeCommand("postgres connection rotate", () => {
  it("rotates the connection's secret", async () => {
    if (connectionId === undefined) throw new Error("no connection to rotate");
    const run = await scratch.run([
      "postgres",
      "connection",
      "rotate",
      connectionId,
      "--confirm",
      connectionId,
    ]);

    expect(run.envelope.ok).toBe(true);
  });
});

describeCommand("postgres connection remove", () => {
  it("removes the connection", async () => {
    if (connectionId === undefined) throw new Error("no connection to remove");
    const run = await scratch.run([
      "postgres",
      "connection",
      "remove",
      connectionId,
      "--confirm",
      connectionId,
    ]);

    expect(run.envelope.ok).toBe(true);
  });
});

describeCommand("postgres remove", () => {
  it("removes the database", async () => {
    const id = requireDatabase();
    const run = await scratch.run(["postgres", "remove", id, "--confirm", id]);

    expect(run.envelope.ok).toBe(true);
  });
});
