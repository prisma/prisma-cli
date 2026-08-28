/** The `project env update` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import {
  formatScopeFlag,
  resolveEnvWriteInput,
  resolveEnvWriteSource,
} from "../../controllers/app-env";
import {
  apiCallError,
  findVariableByNaturalKey,
  type RawEnvironmentVariable,
  toMetadata,
} from "../../controllers/app-env-api";
import { runEnvUpdateFile } from "../../controllers/app-env-file";
import { formatScopeLabel } from "../../lib/app/env-config";
import { runCommand, userChoice } from "../../lib/app/env-errors";
import type { EnvUpdateResult } from "../../types/app-env";
import { operationContext } from "./context";
import {
  branchFlag,
  fileFlag,
  fileWritePresentations,
  projectFlag,
  requireEnvScope,
  resolveEnvTarget,
  roleFlag,
  variableFieldRows,
} from "./env-shared";

const TITLE = "Replacing the environment variable's value.";

function singlePresentations(result: EnvUpdateResult): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      { kind: "summary", status: "info", text: TITLE },
      {
        kind: "fields",
        rows: variableFieldRows(
          result.projectId,
          result.scope,
          // biome-ignore lint/style/noNonNullAssertion: the single-write branch always carries the variable.
          result.variable!,
        ),
      },
    ],
  };
}

export const projectEnvUpdateCommand = defineCommand({
  args: {
    positionals: {
      assignment: positional.optionalString({
        brief:
          "Variable assignment as KEY=VALUE or KEY from the current environment",
        placeholder: "assignment",
      }),
    },
    flags: {
      file: fileFlag,
      role: roleFlag,
      branch: branchFlag,
      project: projectFlag,
    },
  },
  help: {
    summary: "Replace an existing environment variable's value",
    description:
      "Overwrites one variable's value in one scope; the variable must already exist there (use 'project env add' to create it). The new value reaches services on their next deploy.",
    examples: [
      "project env update STRIPE_KEY=sk_new_xxx --role production",
      "project env update STRIPE_KEY=sk_new_xxx --role preview",
      "project env update --file .env --role production",
      "project env update DATABASE_URL=postgresql://branch --branch feature/foo",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const source = resolveEnvWriteSource(
      args.positionals.assignment,
      args.flags.file,
      "update",
    );
    const scope = requireEnvScope(args.flags, "update");
    const input = await resolveEnvWriteInput(
      operationContext(ctx),
      source,
      "update",
    );
    const { projectId, verboseContext, resolved } = await resolveEnvTarget(
      ctx,
      args.flags,
      scope,
      "project env update",
      false,
    );

    if (input.kind === "file") {
      const written = await runEnvUpdateFile(
        operationContext(ctx),
        ctx.api,
        projectId,
        resolved,
        input.filePath,
        input.assignments,
        verboseContext,
      );
      const result: EnvUpdateResult = {
        projectId,
        scope: resolved.descriptor,
        // biome-ignore lint/style/noNonNullAssertion: the file branch always carries the variables.
        variables: written.result.variables!,
        // biome-ignore lint/style/noNonNullAssertion: the file branch always carries the file metadata.
        file: written.result.file!,
      };
      return ok(
        ctx.present(
          { data: result },
          fileWritePresentations(
            {
              title: "Replacing environment variable values from file.",
              emptyMessage: "No environment variables updated.",
              scope: result.scope,
              filePath: result.file.path,
              variables: result.variables,
            },
            result,
          ),
        ),
      );
    }

    const existing = await findVariableByNaturalKey(
      ctx.api,
      projectId,
      input.key,
      resolved,
      ctx.signal,
    );
    if (!existing) {
      throw new CliStructuredError(
        "PROJECT.ENV_VARIABLE_NOT_FOUND",
        `Variable "${input.key}" not found in ${formatScopeLabel(scope)}`,
        {
          why: "No variable with this key exists in the targeted scope.",
          nextActions: [
            userChoice(
              "Use `prisma project env add` to create a new variable.",
            ),
            runCommand(
              `prisma project env add ${input.key}=<value> ${formatScopeFlag(scope)}`,
            ),
          ],
        },
      );
    }

    const { data, error, response } = await ctx.api.PATCH(
      "/v1/environment-variables/{envVarId}",
      {
        params: { path: { envVarId: existing.id } },
        body: { value: input.value },
        signal: ctx.signal,
      },
    );
    if (error || !data) {
      throw apiCallError(
        `Failed to update value for ${input.key}`,
        response,
        error,
      );
    }

    const result: EnvUpdateResult = {
      projectId,
      scope: resolved.descriptor,
      variable: toMetadata(
        data.data as RawEnvironmentVariable,
        resolved.descriptor,
      ),
    };
    return ok(ctx.present({ data: result }, singlePresentations(result)));
  },
});
