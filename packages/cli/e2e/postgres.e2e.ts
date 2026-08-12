/**
 * The Postgres lifecycle against the real API: create a database in a
 * scratch project, read it back every way the CLI offers, manage its
 * connection strings, then remove it.
 */
import { expect, it } from "vitest";

import { scratchDatabaseName, scratchName } from "./harness";
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

function requireConnection(): string {
  if (connectionId === undefined) {
    throw new Error(
      "postgres connection create did not run or did not report an id",
    );
  }
  return connectionId;
}

describeCommand("postgres create", () => {
  it("creates a database in the scratch project", async () => {
    const run = await scratch.run([
      "postgres",
      "create",
      scratchDatabaseName("db"),
    ]);
    const created = run.envelope.result as {
      readonly database: { readonly id: string; readonly name: string };
    };

    expect(created.database.id).toMatch(DATABASE_ID);
    databaseId = created.database.id;
  });
});

interface ListedDatabase {
  readonly id: string;
  readonly status: string | null;
  readonly isDefault: boolean | null;
}

/**
 * The status the API sent, or null. Never the word the CLI used to put
 * here: when the API reported no status, `formatStatus` answered a
 * different question — is this the project's default database — in the
 * status field, so a stopped database read as "default".
 *
 * A mock cannot check this. Its author decides whether the API sends a
 * status at all, which is the assumption under test.
 */
function expectReportedStatus(status: unknown): void {
  expect(status === null || typeof status === "string").toBe(true);
  expect(status).not.toBe("default");
}

describeCommand("postgres list", () => {
  it("lists the database that was just created", async () => {
    const run = await scratch.run(["postgres", "list"]);
    const listed = run.envelope.result as {
      readonly items: ReadonlyArray<{ readonly id: string }>;
    };

    expect(listed.items.map((item) => item.id)).toContain(requireDatabase());
  });

  it("reports the API's status, and the default flag as its own field", async () => {
    const run = await scratch.run(["postgres", "list"]);
    const listed = run.envelope.result as {
      readonly databases: readonly ListedDatabase[];
    };
    const created = listed.databases.find(
      (database) => database.id === requireDatabase(),
    );

    expect(created).toBeDefined();
    expectReportedStatus(created?.status);
    // Two separate facts, carried separately. The defect was the second
    // one standing in for the first.
    expect(typeof created?.isDefault).toBe("boolean");
  });
});

describeCommand("postgres show", () => {
  it("shows the database by id", async () => {
    const run = await scratch.run(["postgres", "show", requireDatabase()]);

    expect(run.envelope.ok).toBe(true);
    expect(JSON.stringify(run.envelope.result)).toContain(requireDatabase());
  });

  it("reports the API's status for the database it read", async () => {
    const run = await scratch.run(["postgres", "show", requireDatabase()]);
    const shown = run.envelope.result as {
      readonly database: ListedDatabase;
    };

    expect(shown.database.id).toBe(requireDatabase());
    expectReportedStatus(shown.database.status);
    expect(typeof shown.database.isDefault).toBe("boolean");
  });
});

describeCommand("postgres usage", () => {
  it("reports usage for the database", async () => {
    const run = await scratch.run(["postgres", "usage", requireDatabase()]);

    expect(run.envelope.ok).toBe(true);
  });

  // The check that a metric is never an invented zero cannot live here.
  // It needs a response that reports no measurement, and against a live
  // API we cannot ask for one. `tests/v8-postgres.test.ts` makes that
  // response with a fake and asserts the answer is "unknown", not `0`.
  // What this test can do is confirm the live API's answer parses into
  // the shape the fix assumes: every field measured or null, never
  // undefined and never a stand-in of another type.
  it("answers with every metric and timestamp either measured or null", async () => {
    const run = await scratch.run(["postgres", "usage", requireDatabase()]);
    const usage = run.envelope.result as {
      readonly period: {
        readonly start: string | null;
        readonly end: string | null;
      };
      readonly metrics: {
        readonly operations: {
          readonly used: number | null;
          readonly unit: string | null;
        };
        readonly storage: {
          readonly used: number | null;
          readonly unit: string | null;
        };
      };
      readonly generatedAt: string | null;
    };

    for (const metric of [usage.metrics.operations, usage.metrics.storage]) {
      expect(metric.used === null || typeof metric.used === "number").toBe(
        true,
      );
      expect(metric.unit === null || typeof metric.unit === "string").toBe(
        true,
      );
    }

    for (const timestamp of [
      usage.period.start,
      usage.period.end,
      usage.generatedAt,
    ]) {
      expect(timestamp === null || typeof timestamp === "string").toBe(true);
    }
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
    expect(JSON.stringify(run.envelope.result)).toContain(requireConnection());
  });
});

describeCommand("postgres connection rotate", () => {
  it("rotates the connection's secret", async () => {
    const run = await scratch.run([
      "postgres",
      "connection",
      "rotate",
      requireConnection(),
      "--confirm",
      requireConnection(),
    ]);

    expect(run.envelope.ok).toBe(true);
  });
});

describeCommand("postgres connection remove", () => {
  it("removes the connection", async () => {
    const run = await scratch.run([
      "postgres",
      "connection",
      "remove",
      requireConnection(),
      "--confirm",
      requireConnection(),
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
