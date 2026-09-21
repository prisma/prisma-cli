/** The `postgres delete` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { resolveDatabase } from "../../controllers/database";
import type { DatabaseDeleteResult } from "../../types/database";
import {
  branchFlag,
  databasePositional,
  projectFlag,
  resolvePostgresContext,
} from "./context";

const CONSENT_QUESTION =
  "Deleting this database is destructive and requires the exact id.";

function deletePresentations(result: DatabaseDeleteResult): Presentations {
  return {
    stdout: () => [],
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
      "Deletion is permanent and destroys the data. The exact database id is the consent token; pass it with --confirm to run non-interactively.",
    examples: ["postgres delete db_123 --confirm db_123"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { provider, target, projectId, projectName } =
      await resolvePostgresContext(ctx, args.flags, "postgres delete");
    const database = await resolveDatabase(
      provider,
      target,
      args.positionals.database,
      args.flags.branch,
      ctx.signal,
    );

    await ctx.prompt.consent(CONSENT_QUESTION, { token: database.id });

    await provider.removeDatabase(database.id, { signal: ctx.signal });

    const result: DatabaseDeleteResult = {
      projectId,
      projectName,
      database,
    };
    return ok(ctx.present({ data: result }, deletePresentations(result)));
  },
});
