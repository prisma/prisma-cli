import { authRequiredError, CliError } from "../shell/errors";
import type { AuthStateResult } from "../types/auth";
import type { ProjectListResult, ProjectSummary } from "../types/project";
import type { ProjectGateway, ProjectUseCases } from "./contracts";

interface ProjectUseCaseDependencies {
  projectGateway: ProjectGateway;
}

export function createProjectUseCases(dependencies: ProjectUseCaseDependencies): ProjectUseCases {
  return {
    list: async (authState: AuthStateResult): Promise<ProjectListResult> => {
      const workspace = requireWorkspace(authState);

      return {
        workspace,
        projects: listSortedWorkspaceProjects(dependencies.projectGateway, workspace.id).map(toProjectSummary),
      };
    },
    listProjectsForWorkspace: async (workspaceId: string): Promise<ProjectSummary[]> =>
      listSortedWorkspaceProjects(dependencies.projectGateway, workspaceId).map(toProjectSummary),
  };
}

function requireWorkspace(authState: AuthStateResult) {
  if (!authState.authenticated || !authState.workspace) {
    throw authRequiredError();
  }

  return authState.workspace;
}

function listSortedWorkspaceProjects(projectGateway: ProjectGateway, workspaceId: string) {
  return projectGateway
    .listProjectsForWorkspace(workspaceId)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function toProjectSummary(project: { id: string; name: string }): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
  };
}

export function projectNotFoundError(
  why: string,
  fix: string,
  nextSteps: string[] = ["prisma-cli project list"],
): CliError {
  return new CliError({
    code: "PROJECT_NOT_FOUND",
    domain: "project",
    summary: "Project not found",
    why,
    fix,
    exitCode: 1,
    nextSteps,
  });
}
