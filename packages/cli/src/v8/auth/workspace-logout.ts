/** The `auth workspace logout` command: ends one workspace session. */
import {
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { environmentCredentialInForce } from "../../auth/service-token";
import { CLI_NAME } from "../../cli-name";
import { ENVIRONMENT_CREDENTIAL_NOTICE } from "./credential-card";
import { requireSession, sessionLabel } from "./session-ref";

export interface WorkspaceLogoutResult {
  readonly workspace: { readonly id: string; readonly name: string | null };
  readonly wasSelected: boolean;
}

function logoutPresentations(spec: {
  readonly result: WorkspaceLogoutResult;
  readonly label: string;
  readonly wasSelected: boolean;
  readonly environmentCredentialInForce: boolean;
}): Presentations {
  const rows = [{ label: "workspace", value: spec.label }];
  return {
    human: () => [
      {
        kind: "summary",
        tone: "info",
        text: "Ending a workspace session.",
      },
      { kind: "fields", rows },
      {
        kind: "summary",
        tone: "ok",
        text: spec.wasSelected
          ? "Ended the current workspace session; no replacement was selected."
          : "Ended the workspace session.",
      },
      ...(spec.environmentCredentialInForce
        ? [
            {
              kind: "summary",
              tone: "info",
              text: ENVIRONMENT_CREDENTIAL_NOTICE,
            } as const,
          ]
        : []),
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    json: () => spec.result,
    next: () => [
      {
        kind: "run-command",
        label: "List your workspace sessions",
        command: `${CLI_NAME} auth workspace list`,
      },
      ...(spec.wasSelected
        ? [
            {
              kind: "run-command",
              label: "Make another session current",
              command: `${CLI_NAME} auth workspace use <id>`,
            } as const,
          ]
        : []),
    ],
  };
}

export const authWorkspaceLogoutCommand = defineCommand({
  managesCredentials: true,
  args: {
    positionals: {
      workspace: positional.string({
        brief: "Workspace id or name",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary: "End one workspace session",
    examples: ["auth workspace logout my-workspace"],
  },
  handler: async (args, ctx) => {
    const stored = await ctx.credentialManager.sessions();
    const session = requireSession(stored.sessions, args.positionals.workspace);
    const wasSelected = session.workspaceId === stored.selectedWorkspaceId;
    await ctx.credentialManager.endSession(session.workspaceId);
    const result: WorkspaceLogoutResult = {
      workspace: {
        id: session.workspaceId,
        name: session.workspaceName ?? null,
      },
      wasSelected,
    };
    return ok(
      ctx.present(
        { data: result },
        logoutPresentations({
          result,
          label: sessionLabel(session),
          wasSelected,
          environmentCredentialInForce: environmentCredentialInForce(ctx.env),
        }),
      ),
    );
  },
});
