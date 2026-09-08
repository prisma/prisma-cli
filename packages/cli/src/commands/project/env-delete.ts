/** The `project env delete` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { formatScopeFlag } from "../../controllers/app-env";
import {
  apiCallError,
  findVariableByNaturalKey,
} from "../../controllers/app-env-api";
import { formatScopeLabel } from "../../lib/app/env-config";
import { runCommand, userChoice } from "../../lib/app/env-errors";
import { scopeLabel } from "../../presenters/app-env";
import type { EnvRmResult } from "../../types/app-env";
import {
  branchFlag,
  projectFlag,
  requireEnvScope,
  resolveEnvTarget,
  roleFlag,
} from "./env-shared";

const TITLE = "Deleting the environment variable from the scope.";

function deletePresentations(result: EnvRmResult): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      { kind: "summary", status: "info", text: TITLE },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.projectId },
          { label: "scope", value: scopeLabel(result.scope) },
          { label: "key", value: result.key },
        ],
      },
    ],
  };
}

export const projectEnvDeleteCommand = defineCommand({
  args: {
    positionals: {
      key: positional.string({
        brief: "Variable key to delete",
        placeholder: "key",
      }),
    },
    flags: {
      role: roleFlag,
      branch: branchFlag,
      project: projectFlag,
    },
  },
  help: {
    summary:
      "Delete an environment variable from one scope: production, preview, or one branch",
    description:
      "Removes the variable from the named scope only; the same key in other scopes is untouched. Services lose the value on their next deploy.",
    examples: [
      "project env delete STRIPE_KEY --role production",
      "project env delete STRIPE_KEY --role preview",
      "project env delete DATABASE_URL --branch feature/foo",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const key = args.positionals.key;
    const scope = requireEnvScope(args.flags, "delete");
    const { projectId, resolved } = await resolveEnvTarget(
      ctx,
      args.flags,
      scope,
      "project env delete",
      false,
    );

    const existing = await findVariableByNaturalKey(
      ctx.api,
      projectId,
      key,
      resolved,
      ctx.signal,
    );
    if (!existing) {
      throw new CliStructuredError(
        "PROJECT.ENV_VARIABLE_NOT_FOUND",
        `Variable "${key}" not found in ${formatScopeLabel(scope)}`,
        {
          why: "No variable with this key exists in the targeted scope, so there is nothing to delete.",
          nextActions: [
            userChoice(
              "Run prisma project env list with the same scope to see the available variables.",
            ),
            runCommand(`prisma project env list ${formatScopeFlag(scope)}`),
          ],
        },
      );
    }

    const { error, response } = await ctx.api.DELETE(
      "/v1/environment-variables/{envVarId}",
      {
        params: { path: { envVarId: existing.id } },
        signal: ctx.signal,
      },
    );
    if (error) {
      throw apiCallError(`Failed to delete ${key}`, response, error);
    }

    const result: EnvRmResult = {
      projectId,
      scope: resolved.descriptor,
      key,
    };
    return ok(ctx.present({ data: result }, deletePresentations(result)));
  },
});
