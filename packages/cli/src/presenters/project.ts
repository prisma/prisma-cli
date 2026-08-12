import { serializeList } from "../output/patterns";
import type {
  GitRepositoryConnection,
  ProjectListResult,
  ProjectSetupResult,
} from "../types/project";

export function serializeProjectList(result: ProjectListResult) {
  return {
    ...serializeList({
      context: {
        workspace: result.workspace.name,
      },
      items: result.projects.map((project) => ({
        noun: "project",
        label: project.name,
        id: project.id,
        status: null,
      })),
    }),
    localBinding: result.localBinding ?? null,
  };
}

export function serializeProjectSetup(result: ProjectSetupResult) {
  return result;
}

export function formatGitConnectionDetail(
  status: GitRepositoryConnection["status"],
): string {
  switch (status) {
    case "active":
      return "GitHub branch automation is active for this project.";
    case "pending":
      return "GitHub branch automation is pending GitHub App installation.";
    case "archived":
      return "GitHub branch automation has been archived for this project.";
    default:
      return "GitHub repository is connected, but branch automation is not active.";
  }
}
