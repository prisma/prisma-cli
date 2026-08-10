/** The `auth workspace logout` command: ends one workspace session. */
import {
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { requireSession, sessionLabel } from "./session-ref";

export interface WorkspaceLogoutResult {
  readonly workspace: { readonly id: string; readonly name: string | null };
  readonly wasCurrent: boolean;
}

function logoutPresentations(spec: {
  readonly label: string;
  readonly wasCurrent: boolean;
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
        text: spec.wasCurrent
          ? "Ended the current workspace session; no replacement was selected."
          : "Ended the workspace session.",
      },
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    next: () => [
      {
        kind: "run-command",
        label: "List your workspace sessions",
        command: `${CLI_NAME} auth workspace list`,
      },
      ...(spec.wasCurrent
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
    const sessions = await ctx.credentialManager.sessions();
    const session = requireSession(sessions, args.positionals.workspace);
    await ctx.credentialManager.endSession(session);
    const result: WorkspaceLogoutResult = {
      workspace: {
        id: session.workspaceId,
        name: session.workspaceName ?? null,
      },
      wasCurrent: session.current,
    };
    return ok(
      ctx.present(
        { data: result },
        logoutPresentations({
          label: sessionLabel(session),
          wasCurrent: session.current,
        }),
      ),
    );
  },
});
