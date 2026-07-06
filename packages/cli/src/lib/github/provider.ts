import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { CliError } from "../../shell/errors";
import type {
  GithubConnectableSummary,
  GithubInstallationSummary,
} from "../../types/github";

export interface GithubProvider {
  listInstallations(workspaceId: string): Promise<GithubInstallationSummary[]>;
  listConnectable(workspaceId: string): Promise<GithubConnectableSummary[]>;
  connect(
    workspaceId: string,
    installationId: number,
  ): Promise<GithubInstallationSummary>;
  createInstallIntent(workspaceId: string): Promise<string>;
}

// The connectable/connect endpoints shipped in the Management API but the
// published @prisma/management-api-sdk does not carry their path types yet.
// This is the single seam that calls them with locally declared shapes;
// delete it and use the typed client once the SDK regen lands.
interface ExperimentalPathsClient {
  GET(
    path: "/v1/scm-installations/connectable",
    init: {
      params: { query: { workspaceId: string } };
      signal?: AbortSignal;
    },
  ): Promise<{
    data?: { data: GithubConnectableSummary[] };
    response: Response;
  }>;
  POST(
    path: "/v1/scm-installations/connect",
    init: {
      body: {
        provider: "github";
        workspaceId: string;
        installationId: number;
      };
      signal?: AbortSignal;
    },
  ): Promise<{
    data?: { data: RawScmInstallation };
    response: Response;
  }>;
}

interface RawScmInstallation {
  installationId: number;
  accountLogin: string;
  accountType: "user" | "organization";
  suspended: boolean;
}

function stripWorkspacePrefix(workspaceId: string): string {
  return workspaceId.replace(/^ws_/, "");
}

export function createGithubProvider(
  client: ManagementApiClient,
  options: { formatCommand: (args: string[]) => string; signal?: AbortSignal },
): GithubProvider {
  const experimental = client as unknown as ExperimentalPathsClient;
  const { formatCommand, signal } = options;

  return {
    async listInstallations(workspaceId) {
      const result = await client.GET("/v1/scm-installations", {
        params: {
          query: { workspaceId: stripWorkspacePrefix(workspaceId), limit: 100 },
        },
        signal,
      });
      if (!result.data) {
        throw githubApiError("list GitHub installations", result.response);
      }
      return result.data.data.map((record) => ({
        installationId: record.installationId,
        accountLogin: record.accountLogin,
        accountType: record.accountType,
        suspended: record.suspended,
      }));
    },

    async listConnectable(workspaceId) {
      const result = await experimental.GET(
        "/v1/scm-installations/connectable",
        {
          params: {
            query: { workspaceId: stripWorkspacePrefix(workspaceId) },
          },
          signal,
        },
      );
      if (!result.data) {
        throw githubApiError(
          "list connectable GitHub installations",
          result.response,
        );
      }
      return result.data.data.map((record) => ({
        installationId: record.installationId,
        accountLogin: record.accountLogin,
      }));
    },

    async connect(workspaceId, installationId) {
      const result = await experimental.POST("/v1/scm-installations/connect", {
        body: {
          provider: "github",
          workspaceId: stripWorkspacePrefix(workspaceId),
          installationId,
        },
        signal,
      });
      if (!result.data) {
        throw githubConnectError(result.response, formatCommand);
      }
      const record = result.data.data;
      return {
        installationId: record.installationId,
        accountLogin: record.accountLogin,
        accountType: record.accountType,
        suspended: record.suspended,
      };
    },

    async createInstallIntent(workspaceId) {
      const result = await client.POST(
        "/v1/scm-installations/install-intents",
        {
          body: {
            provider: "github",
            workspaceId: stripWorkspacePrefix(workspaceId),
          },
          signal,
        },
      );
      if (!result.data) {
        throw githubApiError("create a GitHub install intent", result.response);
      }
      return result.data.data.installUrl;
    },
  };
}

function githubConnectError(
  response: Response,
  formatCommand: (args: string[]) => string,
): CliError {
  if (response.status === 422) {
    return new CliError({
      code: "GITHUB_CONNECT_FAILED",
      domain: "github",
      summary: "GitHub reports the installation no longer exists",
      why: "The Prisma GitHub App was uninstalled from this account out of band; the stale connection records were cleaned up.",
      fix: "Reinstall the app on the GitHub account, then connect it again.",
      exitCode: 1,
      nextSteps: [formatCommand(["github", "install"])],
    });
  }
  return githubApiError("connect the GitHub installation", response);
}

function githubApiError(action: string, response: Response): CliError {
  return new CliError({
    code: "GITHUB_API_ERROR",
    domain: "github",
    summary: `Could not ${action}`,
    why: `The Platform API responded with status ${response.status}.`,
    fix: "Retry; if the problem persists, check the Console or contact support.",
    exitCode: 1,
    meta: { status: response.status },
  });
}
