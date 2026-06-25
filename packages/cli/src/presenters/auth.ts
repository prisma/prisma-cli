import stringWidth from "string-width";
import { renderMutate, renderShow } from "../output/patterns";
import type { CommandDescriptor } from "../shell/command-meta";
import { formatDescriptorLabel } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import { padDisplay } from "../shell/ui";
import type {
  AuthProviderId,
  AuthStateResult,
  AuthWorkspaceListResult,
  AuthWorkspaceLogoutResult,
  AuthWorkspaceUseResult,
} from "../types/auth";

export function renderAuthSuccess(
  context: CommandContext,
  descriptor: CommandDescriptor,
  command: "auth.login" | "auth.logout" | "auth.whoami",
  result: AuthStateResult,
): string[] {
  if (command === "auth.login") {
    const rows: Parameters<typeof renderMutate>[0]["context"] = [];

    if (result.provider) {
      rows.push({ key: "provider", value: providerLabel(result.provider) });
    }

    const userLabel = authUserLabel(result);
    if (userLabel) {
      rows.push({ key: "user", value: userLabel });
    }

    if (result.workspace?.name) {
      rows.push({ key: "workspace", value: result.workspace.name });
    }

    return renderMutate(
      {
        title: "Starting an authenticated CLI session.",
        descriptor,
        context: rows,
        operationDescription: "Applying authentication session changes",
        operationCount: 1,
        details: [
          "Session stored in local CLI state.",
          ...(result.agentSetupTip
            ? [
                `Install Prisma skills for this project with ${result.agentSetupTip.command}.`,
              ]
            : []),
        ],
      },
      context.ui,
    );
  }

  if (command === "auth.logout") {
    return renderMutate(
      {
        title: "Clearing the current CLI session.",
        descriptor,
        context: [{ key: "session", value: "local CLI state", tone: "dim" }],
        operationDescription: "Applying authentication session changes",
        operationCount: 1,
        details: ["Session removed from local CLI state."],
      },
      context.ui,
    );
  }

  return renderShow(
    {
      title: "Showing the current authenticated identity.",
      descriptor,
      fields: result.authenticated
        ? [
            { key: "status", value: "signed in", tone: "success" as const },
            ...authUserRows(result),
            ...(result.provider
              ? [{ key: "provider", value: providerLabel(result.provider) }]
              : []),
            ...(result.workspace?.name
              ? [{ key: "workspace", value: result.workspace.name }]
              : []),
          ]
        : [{ key: "status", value: "signed out", tone: "dim" as const }],
    },
    context.ui,
  );
}

export function renderAuthWorkspaceList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AuthWorkspaceListResult,
): string[] {
  const ui = context.ui;
  const rail = ui.dim("│");
  const lines = [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("Listing authenticated workspaces on this machine.")}`,
    "",
    `${rail}  ${ui.accent("auth source:")}  ${authSourceLabel(result.authSource)}`,
  ];
  const hasMixedSources =
    new Set(result.workspaces.map((workspace) => workspace.source)).size > 1;

  if (result.workspaces.length === 0) {
    lines.push(`${rail}  ${ui.dim("No local OAuth workspaces found.")}`);
    return lines;
  }

  const nameWidth = Math.max(
    "name".length,
    ...result.workspaces.map((workspace) => stringWidth(workspace.name)),
  );
  const idWidth = Math.max(
    "id".length,
    ...result.workspaces.map((workspace) => stringWidth(workspace.id)),
  );
  const sourceWidth = hasMixedSources
    ? Math.max(
        "source".length,
        ...result.workspaces.map((workspace) =>
          stringWidth(workspaceSourceLabel(workspace.source)),
        ),
      )
    : 0;

  lines.push(rail);
  lines.push(
    hasMixedSources
      ? `${rail}  ${ui.accent(padDisplay("name", nameWidth))}  ${ui.accent(padDisplay("id", idWidth))}  ${ui.accent(padDisplay("source", sourceWidth))}  ${ui.accent("status")}`
      : `${rail}  ${ui.accent(padDisplay("name", nameWidth))}  ${ui.accent(padDisplay("id", idWidth))}  ${ui.accent("status")}`,
  );

  for (const workspace of result.workspaces) {
    const status = workspace.active ? "active" : "";
    const source = workspaceSourceLabel(workspace.source);
    lines.push(
      hasMixedSources
        ? `${rail}  ${padDisplay(workspace.name, nameWidth)}  ${padDisplay(workspace.id, idWidth)}  ${padDisplay(source, sourceWidth)}  ${status}`
        : `${rail}  ${padDisplay(workspace.name, nameWidth)}  ${padDisplay(workspace.id, idWidth)}  ${status}`,
    );
  }

  return lines;
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

export function renderAuthWorkspaceUse(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AuthWorkspaceUseResult,
): string[] {
  return renderMutate(
    {
      title: "Switching the local CLI workspace.",
      descriptor,
      context: [
        ...(result.previousWorkspace
          ? [{ key: "previous", value: result.previousWorkspace.name }]
          : []),
        { key: "workspace", value: result.workspace.name },
      ],
      operationDescription: "Applying workspace selection",
      operationCount: 1,
      details: ["Local OAuth workspace selection updated."],
    },
    context.ui,
  );
}

export function serializeAuthWorkspaceUse(result: AuthWorkspaceUseResult) {
  return result;
}

export function renderAuthWorkspaceLogout(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AuthWorkspaceLogoutResult,
): string[] {
  return renderMutate(
    {
      title: "Removing a local OAuth workspace session.",
      descriptor,
      context: [
        { key: "workspace", value: result.workspace.name },
        ...(result.activeWorkspace
          ? [{ key: "active", value: result.activeWorkspace.name }]
          : [{ key: "active", value: "none", tone: "dim" as const }]),
      ],
      operationDescription: "Removing workspace session",
      operationCount: 1,
      details: [
        result.wasActive
          ? "Removed active workspace session; no replacement workspace was selected."
          : "Removed workspace session.",
      ],
    },
    context.ui,
  );
}

export function serializeAuthWorkspaceLogout(
  result: AuthWorkspaceLogoutResult,
) {
  return result;
}

function providerLabel(provider: AuthProviderId | null): string {
  if (provider === "github") {
    return "GitHub";
  }

  if (provider === "google") {
    return "Google";
  }

  return "";
}

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

function authUserLabel(result: AuthStateResult): string | null {
  return result.user?.email ?? credentialUserLabel(result);
}

function authUserRows(
  result: AuthStateResult,
): Parameters<typeof renderShow>[0]["fields"] {
  const userLabel = authUserLabel(result);
  return userLabel ? [{ key: "user", value: userLabel }] : [];
}

function credentialUserLabel(result: AuthStateResult): string | null {
  if (result.credential?.type === "service_token") {
    return result.credential.name
      ? `<service token: ${result.credential.name}>`
      : "<service token>";
  }

  if (result.credential?.type === "management_token") {
    return result.credential.name
      ? `<management token: ${result.credential.name}>`
      : "<management token>";
  }

  return null;
}
