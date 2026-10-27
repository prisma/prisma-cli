/** The `postgres delete` command. */
import {
  type Block,
  defineCommand,
  noDataLines,
  type Presentations,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { consentToken, isNodeAddress } from "../../lib/address/node-address";
import type { DatabaseDeleteResult } from "../../types/database";
import {
  branchFlag,
  databasePositional,
  projectFlag,
  resolvePostgresDatabase,
} from "./context";

function consentQuestion(subject: string): string {
  return `Deleting this database is destructive and requires the exact ${isNodeAddress(subject) ? "address" : "id"}.`;
}

function deletePresentations(result: DatabaseDeleteResult): Presentations {
  return {
    stdout: noDataLines("A delete has no data; its exit code is the result."),
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      { kind: "summary", status: "ok", text: "Deleting database." },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.projectName },
          { label: "database", value: result.database.name },
          { label: "id", value: result.database.id },
        ],
      },
      {
        kind: "list",
        items: ["Database and its connection metadata were deleted."],
      },
    ],
  };
}

export const postgresDeleteCommand = defineCommand({
  args: {
    positionals: { database: databasePositional },
    flags: { project: projectFlag, branch: branchFlag },
  },
  help: {
    summary: "Delete a database after exact id confirmation",
    description:
      "Deletion is permanent and destroys the data. The exact database id is the consent token, or the address when you pass one; pass it with --confirm to run non-interactively.",
    examples: [
      "postgres delete db_123 --confirm db_123",
      "postgres delete @pr-42:shop.db --confirm @pr-42:shop.db",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { provider, projectId, projectName, database } =
      await resolvePostgresDatabase(
        ctx,
        args.flags,
        args.positionals.database,
        "postgres delete",
      );

    await ctx.prompt.consent(consentQuestion(args.positionals.database), {
      token: consentToken(args.positionals.database, database.id),
    });

    await provider.removeDatabase(database.id, { signal: ctx.signal });

    const result: DatabaseDeleteResult = {
      projectId,
      projectName,
      database,
    };
    return ok(ctx.present({ data: result }, deletePresentations(result)));
  },
});
