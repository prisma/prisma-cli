import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type { AuthProviderId, AuthStateResult } from "../types/auth";
import { renderMutate, renderShow } from "../output/patterns";

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
        details: ["Session stored in local CLI state."],
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

function providerLabel(provider: AuthProviderId | null): string {
  if (provider === "github") {
    return "GitHub";
  }

  if (provider === "google") {
    return "Google";
  }

  return "";
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
