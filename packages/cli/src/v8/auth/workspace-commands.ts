/**
 * The `auth workspace *` family, ported from the legacy controller's
 * real-mode paths. Operations come from the auth module
 * (`src/auth/index.ts`); legacy CliError shapes map to dotted AUTH.*
 * structured errors via `mapAuthOperationError`.
 */
import {
  type CommandContext,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import {
  CliStructuredError,
  type NextAction,
  notOk,
  ok,
} from "@prisma/cli-engine/protocol";
import {
  listRealAuthWorkspaces,
  logoutRealAuthWorkspace,
  SERVICE_TOKEN_ENV_VAR,
  useRealAuthWorkspace,
} from "../../auth";
import type {
  AuthWorkspaceListResult,
  AuthWorkspaceLogoutResult,
  AuthWorkspaceUseResult,
} from "../../types/auth";
import { mapAuthOperationError } from "./errors";

const LIST_NEXT_ACTION: NextAction = {
  kind: "run-command",
  label: "List authenticated workspaces",
  command: "prisma-cli auth workspace list",
};

const LOGIN_NEXT_ACTION: NextAction = {
  kind: "run-command",
  label: "Sign in",
  command: "prisma-cli auth login",
};

function operationContext(ctx: CommandContext<undefined, never>): {
  runtime: { env: NodeJS.ProcessEnv; signal: AbortSignal };
} {
  return { runtime: { env: ctx.env, signal: ctx.signal } };
}

function rethrowMapped(error: unknown): never {
  const mapped = mapAuthOperationError(error);
  if (mapped) {
    throw mapped;
  }
  throw error;
}

// --- auth workspace list ---------------------------------------------

function authSourceLabel(
  source: AuthWorkspaceListResult["authSource"],
): string {
  if (source === "oauth") {
    return "local OAuth";
  }
  if (source === "service_token") {
    return "PRISMA_SERVICE_TOKEN";
  }
  return "none";
}

function workspaceSourceLabel(source: "oauth" | "service_token"): string {
  return source === "service_token" ? "service token" : "OAuth";
}

export function serializeAuthWorkspaceList(result: AuthWorkspaceListResult) {
  return {
    context: {
      authSource: result.authSource,
      activeWorkspaceId: result.activeWorkspace?.id ?? null,
      activeWorkspaceName: result.activeWorkspace?.name ?? null,
    },
    items: result.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      status: workspace.active ? "active" : null,
      source: workspace.source,
      switchable: workspace.switchable,
      credentialWorkspaceId: workspace.credentialWorkspaceId,
      lastSeenAt: workspace.lastSeenAt,
    })),
    count: result.workspaces.length,
  };
}

/** The legacy table's column rule: the source column appears only when
 *  the listed workspaces mix sources. */
function workspaceTableRows(result: AuthWorkspaceListResult): {
  columns: readonly string[];
  rows: ReadonlyArray<readonly string[]>;
} {
  const hasMixedSources =
    new Set(result.workspaces.map((workspace) => workspace.source)).size > 1;
  const columns = hasMixedSources
    ? ["name", "id", "source", "status"]
    : ["name", "id", "status"];
  const rows = result.workspaces.map((workspace) => {
    const status = workspace.active ? "active" : "";
    return hasMixedSources
      ? [
          workspace.name,
          workspace.id,
          workspaceSourceLabel(workspace.source),
          status,
        ]
      : [workspace.name, workspace.id, status];
  });
  return { columns, rows };
}

function listPresentations(result: AuthWorkspaceListResult): Presentations {
  const table = workspaceTableRows(result);
  return {
    human: () => [
      {
        kind: "summary",
        tone: "info",
        text: "Listing authenticated workspaces on this machine.",
      },
      {
        kind: "fields",
        rows: [
          { label: "auth source", value: authSourceLabel(result.authSource) },
        ],
      },
      ...(result.workspaces.length === 0
        ? [
            {
              kind: "summary",
              tone: "info",
              text: "No local OAuth workspaces found.",
            } as const,
          ]
        : [{ kind: "table", ...table } as const]),
    ],
    stdout: () => table.rows.map((row) => row.join("  ").trimEnd()),
    json: () => serializeAuthWorkspaceList(result),
    next: () => (result.workspaces.length === 0 ? [LOGIN_NEXT_ACTION] : []),
  };
}

export const authWorkspaceListCommand = defineCommand({
  help: {
    summary: "List locally authenticated workspaces",
    examples: ["auth workspace list", "auth workspace list --json"],
  },
  handler: async (_args, ctx) => {
    let result: AuthWorkspaceListResult;
    try {
      result = await listRealAuthWorkspaces(operationContext(ctx));
    } catch (error) {
      rethrowMapped(error);
    }
    return ok(ctx.present({ data: result }, listPresentations(result)));
  },
});

// --- auth workspace use ----------------------------------------------

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
        command: "prisma-cli auth whoami",
      },
      {
        kind: "run-command",
        label: "List projects",
        command: "prisma-cli project list",
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
          label: "Run prisma-cli auth login and authorize a workspace.",
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
    listed = await listRealAuthWorkspaces(operationContext(ctx));
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
      result = await useRealAuthWorkspace(operationContext(ctx), workspaceRef);
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

// --- auth workspace logout -------------------------------------------

function logoutPresentations(result: AuthWorkspaceLogoutResult): Presentations {
  const rows = [
    { label: "workspace", value: result.workspace.name },
    { label: "active", value: result.activeWorkspace?.name ?? "none" },
  ];
  return {
    human: () => [
      {
        kind: "summary",
        tone: "info",
        text: "Removing a local OAuth workspace session.",
      },
      { kind: "fields", rows },
      {
        kind: "summary",
        tone: "ok",
        text: result.wasActive
          ? "Removed active workspace session; no replacement workspace was selected."
          : "Removed workspace session.",
      },
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    next: () =>
      result.activeWorkspace
        ? [LIST_NEXT_ACTION]
        : [
            LIST_NEXT_ACTION,
            {
              kind: "run-command",
              label: "Select a replacement workspace",
              command: "prisma-cli auth workspace use <id>",
            },
          ],
  };
}

function workspaceRequiredError(): CliStructuredError {
  return new CliStructuredError("AUTH.USAGE_ERROR", "Workspace required", {
    why: "auth workspace logout needs a workspace id or cached workspace name.",
    nextActions: [
      {
        kind: "user-choice",
        label: "Pass a workspace from prisma-cli auth workspace list.",
      },
    ],
  });
}

/** Shared by `auth workspace logout <ref>` and `auth logout
 *  --workspace <ref>` — the same operation, the same presentation. */
export async function runWorkspaceLogout(
  ctx: CommandContext<undefined, never>,
  workspaceRef: string,
) {
  if (!workspaceRef.trim()) {
    return notOk(workspaceRequiredError());
  }

  let result: AuthWorkspaceLogoutResult;
  try {
    result = await logoutRealAuthWorkspace(operationContext(ctx), workspaceRef);
  } catch (error) {
    const mapped = mapAuthOperationError(error);
    if (mapped) {
      return notOk(mapped);
    }
    throw error;
  }
  return ok(ctx.present({ data: result }, logoutPresentations(result)));
}

export const authWorkspaceLogoutCommand = defineCommand({
  args: {
    positionals: {
      workspace: positional.string({
        brief: "Workspace id or exact name",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary: "Remove one local OAuth workspace session",
    examples: ["auth workspace logout my-workspace"],
  },
  handler: async (args, ctx) =>
    runWorkspaceLogout(ctx, args.positionals.workspace),
});
