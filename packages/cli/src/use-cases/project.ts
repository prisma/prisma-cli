import { authRequiredError, CliError } from "../shell/errors";
import type { AuthStateResult } from "../types/auth";
import type { ProjectListResult, ProjectShowResult, ProjectSummary } from "../types/project";
import type { ProjectConfigGateway, ProjectGateway, ProjectUseCases } from "./contracts";

interface ProjectUseCaseDependencies {
  projectGateway: ProjectGateway;
  projectConfigGateway: ProjectConfigGateway;
}

export function createProjectUseCases(dependencies: ProjectUseCaseDependencies): ProjectUseCases {
  return {
    list: async (authState: AuthStateResult): Promise<ProjectListResult> => {
      const workspace = requireWorkspace(authState);

      return {
        workspace,
        linkedProjectId: authState.linkedProjectId,
        projects: listSortedWorkspaceProjects(dependencies.projectGateway, workspace.id).map(toProjectSummary),
      };
    },
    show: async (authState: AuthStateResult): Promise<ProjectShowResult> => {
      if (!authState.linkedProjectId) {
        return {
          linkedProjectId: null,
          workspace: null,
          project: null,
        };
      }

      if (!authState.authenticated || !authState.workspace) {
        return {
          linkedProjectId: authState.linkedProjectId,
          workspace: null,
          project: null,
        };
      }

      const project = dependencies.projectGateway.getProjectForWorkspace(authState.workspace.id, authState.linkedProjectId);

      if (!project) {
        return {
          linkedProjectId: authState.linkedProjectId,
          workspace: null,
          project: null,
        };
      }

      return {
        linkedProjectId: authState.linkedProjectId,
        workspace: authState.workspace,
        project: toProjectSummary(project),
      };
    },
    link: async (authState: AuthStateResult, projectId: string): Promise<ProjectShowResult> => {
      const workspace = requireWorkspace(authState);
      const project = dependencies.projectGateway.getProjectForWorkspace(workspace.id, projectId);

      if (!project) {
        throw projectNotFoundError(
          `The project "${projectId}" does not exist in workspace "${workspace.name}".`,
          "Run prisma project list and choose a project id from the active workspace.",
        );
      }

      await dependencies.projectConfigGateway.writeLinkedProjectId(project.id);

      return {
        linkedProjectId: project.id,
        workspace,
        project: toProjectSummary(project),
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
  nextSteps: string[] = ["prisma project list"],
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
