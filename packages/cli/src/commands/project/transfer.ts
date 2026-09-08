/** The `project transfer` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
  positional,
  SERVICE_TOKEN_ENV_VAR,
} from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import {
  workspaceAmbiguousError,
  workspaceNotAuthenticatedError,
} from "../../auth/errors";
import {
  RecipientSessionInvalidError,
  resolveRecipientWorkspaceSession,
} from "../../auth/recipient";
import { WorkspaceSelectionError } from "../../auth/token-storage";
import { CLI_NAME } from "../../cli-name";
import { formatCommandArgument } from "../../command-arguments";
import {
  rewriteOrClearLocalPinForProject,
  transferRecipientRequiredError,
  transferRecipientUnavailableError,
} from "../../controllers/project";
import type { PrismaCliPackageCommandFormatter } from "../../lib/agent/cli-command";
import { createManagementProjectProvider } from "../../lib/project/provider";
import {
  resolveProjectForSetup,
  toProjectSummary,
} from "../../lib/project/setup";
import type { ProjectTransferResult } from "../../types/project";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import {
  listWorkspaceProjects,
  operationContext,
  type ProjectCommandContext,
} from "./context";
import { localPinDiagnostics } from "./presentation";

const CONSENT_QUESTION =
  "Transferring moves the project to another workspace and this workspace loses access, so it requires the exact project id.";

/** This CLI's command strings are `${CLI_NAME} …`; the legacy package-runner
 *  formatter does not port. */
const formatCommand: PrismaCliPackageCommandFormatter = (args) =>
  [CLI_NAME, ...args].join(" ");

interface TransferRecipient {
  readonly accessToken: string;
  readonly workspaceId: string | null;
  readonly workspaceName: string | null;
  readonly source: "workspace-session" | "recipient-token";
}

function recipientSourceError(workspaceRef: string, error: unknown): never {
  if (error instanceof WorkspaceSelectionError) {
    if (error.reason === "ambiguous") {
      throw workspaceAmbiguousError(
        error.workspaceRef ?? workspaceRef,
        error.matches.map((match) => ({
          id: match.id,
          name: match.name,
          credentialWorkspaceId: match.credentialWorkspaceId,
        })),
      );
    }
    throw workspaceNotAuthenticatedError(error.workspaceRef ?? workspaceRef);
  }
  if (error instanceof RecipientSessionInvalidError) {
    throw workspaceNotAuthenticatedError(error.workspaceRef);
  }
  throw error;
}

async function resolveRecipient(
  ctx: ProjectCommandContext,
  options: { toWorkspace?: string; recipientToken?: string },
): Promise<TransferRecipient> {
  const recipientToken = options.recipientToken?.trim();
  if (recipientToken) {
    return {
      accessToken: recipientToken,
      workspaceId: null,
      workspaceName: null,
      source: "recipient-token",
    };
  }

  /** The handler rejects a run carrying neither recipient flag before
   *  it reaches here, so a blank `--to-workspace` means the recipient
   *  token was set and returned above. */
  const workspaceRef = options.toWorkspace?.trim() ?? "";

  if (ctx.env[SERVICE_TOKEN_ENV_VAR] !== undefined) {
    throw transferRecipientUnavailableError(formatCommand);
  }

  try {
    const session = await resolveRecipientWorkspaceSession(
      workspaceRef,
      ctx.env,
      ctx.signal,
    );
    return {
      accessToken: session.accessToken,
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      source: "workspace-session",
    };
  } catch (error) {
    recipientSourceError(workspaceRef, error);
  }
}

function transferPresentations(
  result: ProjectTransferResult,
  toWorkspace: string | undefined,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: (): Block[] => [
      { kind: "summary", status: "ok", text: "Transferring project." },
      {
        kind: "fields",
        rows: [
          { label: "workspace", value: result.workspace.name },
          { label: "project", value: result.project.name },
          { label: "id", value: result.project.id },
          {
            label: "recipient",
            value:
              result.recipient.workspaceName ??
              result.recipient.workspaceId ??
              "workspace of the provided recipient token",
          },
        ],
      },
      {
        kind: "list",
        items: [
          "The project now belongs to the recipient workspace; this workspace no longer has access.",
          ...(result.localPin.action === "rewritten"
            ? [
                "This directory's local project binding now points at the recipient workspace.",
              ]
            : []),
          ...(result.localPin.action === "cleared"
            ? ["This directory's local project binding was cleared."]
            : []),
        ],
      },
    ],
    next: () =>
      toWorkspace
        ? [
            {
              kind: "run-command",
              label: `${CLI_NAME} auth workspace use ${formatCommandArgument(toWorkspace)}`,
              command: `${CLI_NAME} auth workspace use ${formatCommandArgument(toWorkspace)}`,
            },
          ]
        : [],
  };
}

export const projectTransferCommand = defineCommand({
  args: {
    positionals: {
      project: positional.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
    },
    flags: {
      toWorkspace: flag.string({
        brief:
          "Receiving workspace, when it is one of your own stored sessions",
        placeholder: "id-or-name",
      }),
      recipientToken: flag.string({
        brief:
          "Access token for the receiving workspace, when you are not a member of it",
        placeholder: "token",
      }),
    },
  },
  help: {
    summary:
      "Transfer a Project to another workspace after exact id confirmation",
    description:
      "Moves a project, with everything in it, out of the current workspace. Name the receiving workspace with --to-workspace when you are logged in to it too, or pass --recipient-token when someone else owns it. The exact project id is the consent token.",
    examples: [
      'project transfer proj_123 --to-workspace "Prisma Labs" --confirm proj_123',
      "project transfer proj_123 --recipient-token <token> --confirm proj_123",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const workspace = await resolveActiveWorkspace(ctx);
    // Normalized once: an all-whitespace flag value must not read as
    // supplied to one check and absent to the next.
    const toWorkspace = args.flags.toWorkspace?.trim() || undefined;
    const recipientToken = args.flags.recipientToken?.trim() || undefined;

    if (toWorkspace && recipientToken) {
      const retry = formatCommand([
        "project",
        "transfer",
        "<project>",
        "--to-workspace",
        "<id-or-name>",
        "--confirm",
        "<project-id>",
      ]);
      throw new CliStructuredError(
        "PROJECT.USAGE_ERROR",
        "Choose one transfer recipient source",
        {
          why: "--to-workspace and --recipient-token are mutually exclusive.",
          nextActions: [
            {
              kind: "user-choice",
              label:
                "Pass either --to-workspace <id-or-name> or --recipient-token <token>.",
            },
            { kind: "run-command", label: retry, command: retry },
          ],
        },
      );
    }
    if (!toWorkspace && !recipientToken) {
      throw transferRecipientRequiredError(formatCommand);
    }

    const projects = await listWorkspaceProjects(ctx);
    const project = toProjectSummary(
      resolveProjectForSetup(
        args.positionals.project.trim(),
        projects,
        workspace,
      ),
    );

    await ctx.prompt.consent(CONSENT_QUESTION, { token: project.id });

    const recipient = await resolveRecipient(ctx, {
      toWorkspace,
      recipientToken,
    });
    await createManagementProjectProvider(ctx.api).transferProject({
      projectId: project.id,
      recipientAccessToken: recipient.accessToken,
      signal: ctx.signal,
    });

    const warnings: string[] = [];
    const action = await rewriteOrClearLocalPinForProject(
      operationContext(ctx),
      project.id,
      recipient.workspaceId,
      { onError: (message) => warnings.push(message) },
    );

    const result: ProjectTransferResult = {
      workspace,
      project,
      recipient: {
        workspaceId: recipient.workspaceId,
        workspaceName: recipient.workspaceName,
        source: recipient.source,
      },
      localPin: { action },
    };
    const diagnostics: Diagnostic[] = localPinDiagnostics(warnings);
    return ok(
      ctx.present(
        { data: result, diagnostics },
        transferPresentations(result, toWorkspace),
      ),
    );
  },
});
