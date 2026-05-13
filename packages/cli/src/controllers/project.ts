import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { authRequiredError, workspaceRequiredError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import type { AuthWorkspace } from "../types/auth";
import type { ProjectListResult, ProjectShowResult } from "../types/project";
import { requireComputeAuth } from "../lib/auth/guard";
import {
  resolveProjectTarget,
  sortProjects,
  type ProjectCandidate,
} from "../lib/project/resolution";
import { createProjectUseCases } from "../use-cases/project";
import { createCliUseCaseGateways } from "../use-cases/create-cli-gateways";
import { requireAuthenticatedAuthState } from "./auth";

function isRealMode(context: CommandContext): boolean {
  return !context.runtime.fixturePath && !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH;
}

export async function runProjectList(context: CommandContext): Promise<CommandSuccess<ProjectListResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (isRealMode(context)) {
    const client = await requireComputeAuth(context.runtime.env);
    if (!client) {
      throw authRequiredError();
    }

    return {
      command: "project.list",
      result: {
        workspace,
        projects: sortProjects(await listRealWorkspaceProjects(client, workspace)).map(toProjectSummary),
      },
      warnings: [],
      nextSteps: [],
    };
  }

  const projectUseCases = createProjectUseCases(createCliUseCaseGateways(context));
  const result = await projectUseCases.list(authState);

  return {
    command: "project.list",
    result,
    warnings: [],
    nextSteps: [],
  };
}

export async function runProjectShow(
  context: CommandContext,
  explicitProject: string | undefined,
): Promise<CommandSuccess<ProjectShowResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  const result = isRealMode(context)
    ? await resolveProjectShowInRealMode(context, workspace, explicitProject)
    : await resolveProjectShowInFixtureMode(context, workspace, explicitProject);

  return {
    command: "project.show",
    result,
    warnings: [],
    nextSteps: [],
  };
}

async function resolveProjectShowInRealMode(
  context: CommandContext,
  workspace: AuthWorkspace,
  explicitProject: string | undefined,
): Promise<ProjectShowResult> {
  const client = await requireComputeAuth(context.runtime.env);
  if (!client) {
    throw authRequiredError();
  }

  return resolveProjectTarget({
    context,
    workspace,
    explicitProject,
    listProjects: () => listRealWorkspaceProjects(client, workspace),
    remember: false,
  });
}

async function resolveProjectShowInFixtureMode(
  context: CommandContext,
  workspace: AuthWorkspace,
  explicitProject: string | undefined,
): Promise<ProjectShowResult> {
  return resolveProjectTarget({
    context,
    workspace,
    explicitProject,
    listProjects: async () => listFixtureWorkspaceProjects(context, workspace),
    remember: false,
  });
}

export async function listRealWorkspaceProjects(
  client: ManagementApiClient,
  workspace: AuthWorkspace,
): Promise<ProjectCandidate[]> {
  const { data } = await client.GET("/v1/projects", {});
  return sortProjects(
    (data?.data ?? [])
      .filter((project) => project.workspace.id === workspace.id)
      .map((project) => ({
        id: project.id,
        name: project.name,
        slug: "slug" in project && typeof project.slug === "string" ? project.slug : null,
        workspace: {
          id: project.workspace.id,
          name: project.workspace.name,
        },
      })),
  );
}

export function listFixtureWorkspaceProjects(
  context: CommandContext,
  workspace: AuthWorkspace,
): ProjectCandidate[] {
  return sortProjects(
    context.api.listProjectsForWorkspace(workspace.id).map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      workspace,
    })),
  );
}

function toProjectSummary(project: ProjectCandidate) {
  return {
    id: project.id,
    name: project.name,
  };
}
