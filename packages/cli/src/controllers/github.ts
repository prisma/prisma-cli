import { resolvePrismaCliPackageCommandFormatterSync } from "../lib/agent/cli-command";
import { requireComputeAuth } from "../lib/auth/guard";
import { createGithubProvider } from "../lib/github/provider";
import {
  authRequiredError,
  CliError,
  workspaceRequiredError,
} from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import type {
  GithubConnectableSummary,
  GithubConnectResult,
  GithubInstallResult,
  GithubListResult,
} from "../types/github";
import { requireAuthenticatedAuthState } from "./auth";

function isRealMode(context: CommandContext): boolean {
  return (
    !context.runtime.fixturePath &&
    !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH
  );
}

async function resolveWorkspaceAndProvider(context: CommandContext) {
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(
    context.runtime.cwd,
  );
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (!isRealMode(context)) {
    return { workspace, formatCommand, provider: null };
  }

  const client = await requireComputeAuth(
    context.runtime.env,
    context.runtime.signal,
  );
  if (!client) {
    throw authRequiredError(["prisma-cli auth login"]);
  }
  return {
    workspace,
    formatCommand,
    provider: createGithubProvider(client, {
      formatCommand,
      signal: context.runtime.signal,
    }),
  };
}

export async function runGithubList(
  context: CommandContext,
): Promise<CommandSuccess<GithubListResult>> {
  const { workspace, provider, formatCommand } =
    await resolveWorkspaceAndProvider(context);

  const [connected, connectable] = provider
    ? await Promise.all([
        provider.listInstallations(workspace.id),
        provider.listConnectable(workspace.id),
      ])
    : [
        context.api.listScmInstallations(workspace.id),
        context.api.listConnectableScmInstallations(workspace.id),
      ];

  return {
    command: "github.list",
    result: { workspace, connected, connectable },
    warnings: [],
    nextSteps:
      connectable.length > 0
        ? [formatCommand(["github", "connect", connectable[0].accountLogin])]
        : [],
  };
}

export async function runGithubConnect(
  context: CommandContext,
  accountRef: string | undefined,
): Promise<CommandSuccess<GithubConnectResult>> {
  const { workspace, provider, formatCommand } =
    await resolveWorkspaceAndProvider(context);

  const connectable = provider
    ? await provider.listConnectable(workspace.id)
    : context.api.listConnectableScmInstallations(workspace.id);

  if (!accountRef) {
    throw githubAccountRequiredError(connectable, formatCommand);
  }

  const target = resolveConnectableAccount(accountRef, connectable);
  if (!target) {
    throw githubAccountNotFoundError(accountRef, connectable, formatCommand);
  }

  const installation = provider
    ? await provider.connect(workspace.id, target.installationId)
    : context.api.connectScmInstallation(workspace.id, target.installationId);

  return {
    command: "github.connect",
    result: { workspace, installation },
    warnings: [],
    nextSteps: [formatCommand(["github", "list"])],
  };
}

export async function runGithubInstall(
  context: CommandContext,
): Promise<CommandSuccess<GithubInstallResult>> {
  const { workspace, provider } = await resolveWorkspaceAndProvider(context);

  const installUrl = provider
    ? await provider.createInstallIntent(workspace.id)
    : `https://github.com/apps/prisma/installations/new?state=fixture-nonce`;

  return {
    command: "github.install",
    result: { workspace, installUrl },
    warnings: [],
    nextSteps: [],
  };
}

function resolveConnectableAccount(
  accountRef: string,
  connectable: GithubConnectableSummary[],
): GithubConnectableSummary | undefined {
  return connectable.find(
    (candidate) =>
      candidate.accountLogin === accountRef ||
      String(candidate.installationId) === accountRef,
  );
}

function githubAccountRequiredError(
  connectable: GithubConnectableSummary[],
  formatCommand: (args: string[]) => string,
): CliError {
  return new CliError({
    code: "GITHUB_ACCOUNT_REQUIRED",
    domain: "github",
    summary: "GitHub account required",
    why:
      connectable.length > 0
        ? "Pass the GitHub account to connect to this workspace."
        : "No GitHub account is connectable to this workspace; installations of other workspaces you belong to would appear here.",
    fix:
      connectable.length > 0
        ? "Rerun with one of the connectable accounts."
        : "Install the Prisma GitHub App first, then connect it.",
    exitCode: 2,
    meta: { connectable },
    nextSteps:
      connectable.length > 0
        ? connectable.map((candidate) =>
            formatCommand(["github", "connect", candidate.accountLogin]),
          )
        : [formatCommand(["github", "install"])],
  });
}

function githubAccountNotFoundError(
  accountRef: string,
  connectable: GithubConnectableSummary[],
  formatCommand: (args: string[]) => string,
): CliError {
  return new CliError({
    code: "GITHUB_ACCOUNT_NOT_FOUND",
    domain: "github",
    summary: `Unknown GitHub account "${accountRef}"`,
    why: "The account is not connectable to this workspace: it is either unknown, already connected here, or belongs to workspaces you are not a member of.",
    fix:
      connectable.length > 0
        ? "Pass one of the connectable accounts by login or installation id."
        : "Install the Prisma GitHub App on the account first.",
    exitCode: 1,
    meta: { accountRef, connectable },
    nextSteps:
      connectable.length > 0
        ? connectable.map((candidate) =>
            formatCommand(["github", "connect", candidate.accountLogin]),
          )
        : [formatCommand(["github", "install"])],
  });
}
