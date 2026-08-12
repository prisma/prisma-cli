/** The `project env add` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
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
import { runEnvAddFile } from "../../controllers/app-env-file";
import { CliError } from "../../errors";
import { formatScopeLabel } from "../../lib/app/env-config";
import type { EnvAddResult } from "../../types/app-env";
import { legacyOperationContext } from "./context";
import {
  branchFlag,
  fileFlag,
  fileWritePresentations,
  previewDefaultDiagnostics,
  projectFlag,
  requireEnvScope,
  resolveEnvTarget,
  roleFlag,
  variableFieldRows,
} from "./env-shared";
import { mapProjectOperationError } from "./errors";

const TITLE = "Setting a new environment variable.";

function singlePresentations(result: EnvAddResult): Presentations {
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

export const projectEnvAddCommand = defineCommand({
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
    summary: "Create a new environment variable.",
    examples: [
      "project env add STRIPE_KEY=sk_test_xxx --role production",
      "project env add STRIPE_KEY=sk_test_xxx --role preview",
      "project env add --file .env --role preview",
      "project env add DATABASE_URL=postgresql://branch --branch feature/foo",
      "project env add --file .env.local --branch feature/foo",
      "API_URL=https://api.example prisma-cli project env add API_URL --project proj_123 --role preview",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const source = resolveEnvWriteSource(
        args.positionals.assignment,
        args.flags.file,
        "add",
      );
      const scope = requireEnvScope(args.flags, "add");
      const input = await resolveEnvWriteInput(
        legacyOperationContext(ctx),
        source,
        "add",
      );
      const { projectId, verboseContext, resolved } = await resolveEnvTarget(
        ctx,
        args.flags,
        scope,
        "project env add",
        true,
      );

      if (input.kind === "file") {
        const written = await runEnvAddFile(
          legacyOperationContext(ctx),
          ctx.api,
          projectId,
          resolved,
          input.filePath,
          input.assignments,
          verboseContext,
        );
        const result: EnvAddResult = {
          projectId,
          scope: resolved.descriptor,
          // biome-ignore lint/style/noNonNullAssertion: the file branch always carries the variables.
          variables: written.result.variables!,
          // biome-ignore lint/style/noNonNullAssertion: the file branch always carries the file metadata.
          file: written.result.file!,
        };
        return ok(
          ctx.present(
            {
              data: result,
              diagnostics: previewDefaultDiagnostics(written.warnings),
            },
            fileWritePresentations(
              {
                title: "Setting new environment variables from file.",
                emptyMessage: "No environment variables imported.",
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
      if (existing) {
        throw new CliError({
          code: "ENV_VARIABLE_ALREADY_EXISTS",
          domain: "app",
          summary: `Variable "${input.key}" already exists in ${formatScopeLabel(scope)}`,
          why: "A variable with this key already exists in the targeted scope.",
          fix: "Use `prisma-cli project env update` to change an existing variable's value.",
          exitCode: 1,
          nextSteps: [
            `prisma-cli project env update ${input.key}=<new-value> ${formatScopeFlag(scope)}`,
          ],
        });
      }

      const warnings =
        scope.kind === "branch" &&
        !(await findVariableByNaturalKey(
          ctx.api,
          projectId,
          input.key,
          {
            descriptor: { kind: "role", role: "preview" },
            apiTarget: { class: "preview", branchId: null },
          },
          ctx.signal,
        ))
          ? [
              `Variable "${input.key}" does not exist in preview. It will only exist on ${formatScopeLabel(scope)}.`,
            ]
          : [];

      const { data, error, response } = await ctx.api.POST(
        "/v1/environment-variables",
        {
          body: {
            projectId,
            class: resolved.apiTarget.class,
            ...(resolved.apiTarget.branchId !== null
              ? { branchId: resolved.apiTarget.branchId }
              : {}),
            key: input.key,
            value: input.value,
          },
          signal: ctx.signal,
        },
      );
      if (error || !data) {
        throw apiCallError(`Failed to add ${input.key}`, response, error);
      }

      const result: EnvAddResult = {
        projectId,
        scope: resolved.descriptor,
        variable: toMetadata(
          data.data as RawEnvironmentVariable,
          resolved.descriptor,
        ),
      };
      return ok(
        ctx.present(
          {
            data: result,
            diagnostics: previewDefaultDiagnostics(warnings),
          },
          singlePresentations(result),
        ),
      );
    } catch (error) {
      const mapped = mapProjectOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
