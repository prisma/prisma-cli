/** The `auth workspace use` command. */
import {
  type CommandContext,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import {
  listAuthWorkspaces,
  SERVICE_TOKEN_ENV_VAR,
  useAuthWorkspace,
} from "../../auth";
import { CLI_NAME } from "../../cli-name";
import type {
  AuthWorkspaceListResult,
  AuthWorkspaceUseResult,
} from "../../types/auth";
import { mapAuthOperationError } from "./errors";
import { operationContext, rethrowMapped } from "./workspace-shared";

function usePresentations(result: AuthWorkspaceUseResult): Presentations {
  const rows = [
    ...(result.previousWorkspace
      ? [{ label: "previous", value: result.previousWorkspace.name }]
      : []),
    { label: "workspace", value: result.workspace.name },
  ];
  return {
    human: () => [
      {
        kind: "summary",
        tone: "info",
        text: "Switching the local CLI workspace.",
      },
      { kind: "fields", rows },
      {
        kind: "summary",
        tone: "ok",
        text: "Local OAuth workspace selection updated.",
      },
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    next: () => [
      {
        kind: "run-command",
        label: "Show the signed-in identity",
        command: `${CLI_NAME} auth whoami`,
      },
      {
        kind: "run-command",
        label: "List projects",
        command: `${CLI_NAME} project list`,
      },
    ],
  };
}

function noWorkspacesError(): CliStructuredError {
  return new CliStructuredError(
    "AUTH.USAGE_ERROR",
    "No authenticated workspaces",
    {
      why: "There are no local OAuth workspace sessions to select.",
      nextActions: [
        {
          kind: "user-choice",
          label: `Run ${CLI_NAME} auth login and authorize a workspace.`,
        },
      ],
    },
  );
}

function serviceTokenSwitchError(): CliStructuredError {
  return new CliStructuredError(
    "AUTH.WORKSPACE_SWITCH_UNAVAILABLE",
    "Workspace switching is unavailable",
    {
      why: "PRISMA_SERVICE_TOKEN is set, so authenticated commands use that token instead of local OAuth workspaces.",
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Unset PRISMA_SERVICE_TOKEN to switch between local OAuth workspaces, or use a token for the workspace you want.",
        },
      ],
    },
  );
}

async function selectWorkspaceRef(
  ctx: CommandContext<undefined, never>,
): Promise<string> {
  if (ctx.env[SERVICE_TOKEN_ENV_VAR] !== undefined) {
    throw serviceTokenSwitchError();
  }

  let listed: AuthWorkspaceListResult;
  try {
    listed = await listAuthWorkspaces(operationContext(ctx));
  } catch (error) {
    rethrowMapped(error);
  }
  const workspaces = listed.workspaces.filter(
    (workspace) => workspace.switchable,
  );

  if (workspaces.length === 0) {
    throw noWorkspacesError();
  }

  if (workspaces.length === 1) {
    return workspaces[0].id;
  }

  return await ctx.prompt.select(
    "Select a workspace",
    workspaces.map((workspace) => ({
      value: workspace.id,
      label: `${workspace.name} (${workspace.id})${workspace.active ? " active" : ""}`,
    })),
  );
}

export const authWorkspaceUseCommand = defineCommand({
  args: {
    positionals: {
      workspace: positional.optionalString({
        brief: "Workspace id or exact name",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary: "Switch the local CLI workspace",
    examples: ["auth workspace use", "auth workspace use my-workspace"],
  },
  handler: async (args, ctx) => {
    const trimmed = args.positionals.workspace?.trim();
    const workspaceRef = trimmed ? trimmed : await selectWorkspaceRef(ctx);

    let result: AuthWorkspaceUseResult;
    try {
      result = await useAuthWorkspace(operationContext(ctx), workspaceRef);
    } catch (error) {
      const mapped = mapAuthOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
    return ok(ctx.present({ data: result }, usePresentations(result)));
  },
});
