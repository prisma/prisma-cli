import type { AuthWorkspace } from "./auth";

export interface GithubInstallationSummary {
  /** Numeric GitHub App installation id. */
  installationId: number;
  accountLogin: string;
  accountType: "user" | "organization";
  suspended: boolean;
}

export interface GithubConnectableSummary {
  /** Numeric GitHub App installation id. */
  installationId: number;
  accountLogin: string;
}

export interface GithubListResult {
  workspace: AuthWorkspace;
  connected: GithubInstallationSummary[];
  connectable: GithubConnectableSummary[];
}

export interface GithubConnectResult {
  workspace: AuthWorkspace;
  installation: GithubInstallationSummary;
}

export interface GithubInstallResult {
  workspace: AuthWorkspace;
  installUrl: string;
}
