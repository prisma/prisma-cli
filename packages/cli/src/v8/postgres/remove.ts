/** The `postgres remove` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { resolveDatabase } from "../../controllers/database";
import type { DatabaseRemoveResult } from "../../types/database";
import {
  branchFlag,
  databasePositional,
  projectFlag,
  resolvePostgresContext,
} from "./context";
import { mapPostgresOperationError } from "./errors";

const CONSENT_QUESTION =
  "Removing this database is destructive and requires the exact id.";

function removePresentations(result: DatabaseRemoveResult): Presentations {
  return {
    human: (): Block[] => [
      { kind: "summary", tone: "ok", text: "Removing database." },
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
        items: ["Database and its connection metadata were removed."],
      },
    ],
  };
}

export const postgresRemoveCommand = defineCommand({
  args: {
    positionals: { database: databasePositional },
    flags: { project: projectFlag, branch: branchFlag },
  },
  help: {
    summary: "Remove a database after exact id confirmation",
    examples: ["postgres remove db_123 --confirm db_123"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const { provider, target, projectId, projectName } =
        await resolvePostgresContext(ctx, args.flags, "postgres remove");
      const database = await resolveDatabase(
        provider,
        target,
        args.positionals.database,
        args.flags.branch,
        ctx.signal,
      );

      await ctx.prompt.consent(CONSENT_QUESTION, { token: database.id });

      await provider.removeDatabase(database.id, { signal: ctx.signal });

      const result: DatabaseRemoveResult = {
        projectId,
        projectName,
        database,
      };
      return ok(ctx.present({ data: result }, removePresentations(result)));
    } catch (error) {
      const mapped = mapPostgresOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
