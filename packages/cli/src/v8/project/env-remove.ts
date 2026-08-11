/** The `project env remove` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { formatScopeFlag } from "../../controllers/app-env";
import {
  apiCallError,
  findVariableByNaturalKey,
} from "../../controllers/app-env-api";
import { formatScopeLabel } from "../../lib/app/env-config";
import { scopeLabel } from "../../presenters/app-env";
import { CliError } from "../../shell/errors";
import type { EnvRmResult } from "../../types/app-env";
import {
  branchFlag,
  projectFlag,
  requireEnvScope,
  resolveEnvTarget,
  roleFlag,
} from "./env-shared";
import { mapProjectOperationError } from "./errors";

const TITLE = "Removing the environment variable from the scope.";

function removePresentations(result: EnvRmResult): Presentations {
  return {
    human: (): Block[] => [
      { kind: "summary", tone: "info", text: TITLE },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.projectId },
          { label: "scope", value: scopeLabel(result.scope) },
          { label: "key", value: result.key },
        ],
      },
    ],
    stdout: () => [],
    json: () => result,
    next: () => [],
  };
}

export const projectEnvRemoveCommand = defineCommand({
  args: {
    positionals: {
      key: positional.string({
        brief: "Variable key to remove",
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
    summary: "Remove an environment variable from a scope.",
    examples: [
      "project env remove STRIPE_KEY --role production",
      "project env remove STRIPE_KEY --role preview",
      "project env remove DATABASE_URL --branch feature/foo",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const key = args.positionals.key;
      const scope = requireEnvScope(args.flags, "remove");
      const { projectId, resolved } = await resolveEnvTarget(
        ctx,
        args.flags,
        scope,
        "project env remove",
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
        throw new CliError({
          code: "ENV_VARIABLE_NOT_FOUND",
          domain: "app",
          summary: `Variable "${key}" not found in ${formatScopeLabel(scope)}`,
          why: "No variable with this key exists in the targeted scope, so there is nothing to remove.",
          fix: "Run prisma-cli project env list with the same scope to see the available variables.",
          exitCode: 1,
          nextSteps: [`prisma-cli project env list ${formatScopeFlag(scope)}`],
        });
      }

      const { error, response } = await ctx.api.DELETE(
        "/v1/environment-variables/{envVarId}",
        {
          params: { path: { envVarId: existing.id } },
          signal: ctx.signal,
        },
      );
      if (error) {
        throw apiCallError(`Failed to remove ${key}`, response, error);
      }

      const result: EnvRmResult = {
        projectId,
        scope: resolved.descriptor,
        key,
      };
      return ok(ctx.present({ data: result }, removePresentations(result)));
    } catch (error) {
      const mapped = mapProjectOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
