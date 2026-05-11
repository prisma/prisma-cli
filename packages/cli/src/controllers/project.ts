import { authRequiredError, CliError, usageError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import { canPrompt, type CommandContext } from "../shell/runtime";
import type { AuthStateResult } from "../types/auth";
import type { ProjectListResult, ProjectShowResult, ProjectSummary } from "../types/project";
import { createAuthUseCases } from "../use-cases/auth";
import { createCliUseCaseGateways } from "../use-cases/create-cli-gateways";
import { createProjectUseCases, projectNotFoundError } from "../use-cases/project";
import { requireAuthenticatedAuthState } from "./auth";
import { createSelectPromptPort } from "./select-prompt-port";
import { UnsafeConfigWriteError, readLinkedProjectId, writeLinkedProjectId } from "../adapters/config";
import { readAuthState } from "../lib/auth/auth-ops";
import { requireComputeAuth } from "../lib/auth/guard";

function isRealMode(context: CommandContext): boolean {
  return !context.runtime.fixturePath && !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH;
}

export async function runProjectList(context: CommandContext): Promise<CommandSuccess<ProjectListResult>> {
  if (isRealMode(context)) {
    const authState = await requireAuthenticatedAuthState(context);
    const client = await requireComputeAuth(context.runtime.env);
    const workspace = authState.workspace;

    if (!client || !workspace) {
      throw authRequiredError();
    }

    const { data: projectsData } = await client.GET("/v1/projects", {});
    const linkedProjectId = await readLinkedProjectId(context.runtime.cwd);
    const projects = (projectsData?.data ?? [])
      .filter((project) => project.workspace.id === workspace.id)
      .map((project) => ({
        id: project.id,
        name: project.name,
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

    return {
      command: "project.list",
      result: {
        workspace,
        linkedProjectId,
        projects,
      },
      warnings: [],
      nextSteps: ["prisma-cli project link"],
    };
  }

  const authState = await requireAuthenticatedAuthState(context);
  const projectUseCases = createProjectUseCases(createCliUseCaseGateways(context));
  const result = await projectUseCases.list(authState);

  return {
    command: "project.list",
    result,
    warnings: [],
    nextSteps: ["prisma-cli project link"],
  };
}

export async function runProjectShow(context: CommandContext): Promise<CommandSuccess<ProjectShowResult>> {
  if (isRealMode(context)) {
    const linkedProjectId = await readLinkedProjectId(context.runtime.cwd);

    if (!linkedProjectId) {
      return {
        command: "project.show",
        result: {
          linkedProjectId: null,
          workspace: null,
          project: null,
        },
        warnings: [],
        nextSteps: ["prisma-cli project link"],
      };
    }

    const authState = await readAuthState(context.runtime.env);

    if (!authState.authenticated || !authState.workspace) {
      return {
        command: "project.show",
        result: {
          linkedProjectId,
          workspace: null,
          project: null,
        },
        warnings: [],
        nextSteps: ["prisma-cli auth login"],
      };
    }

    const client = await requireComputeAuth(context.runtime.env);

    if (!client) {
      return {
        command: "project.show",
        result: {
          linkedProjectId,
          workspace: null,
          project: null,
        },
        warnings: [],
        nextSteps: ["prisma-cli auth login"],
      };
    }

    try {
      const { data } = await client.GET("/v1/projects/{id}", {
        params: { path: { id: linkedProjectId } },
      });
      const project = data?.data;

      if (!project || project.workspace.id !== authState.workspace.id) {
        return {
          command: "project.show",
          result: {
            linkedProjectId,
            workspace: null,
            project: null,
          },
          warnings: [],
          nextSteps: [],
        };
      }

      return {
        command: "project.show",
        result: {
          linkedProjectId,
          workspace: {
            id: project.workspace.id,
            name: project.workspace.name,
          },
          project: {
            id: project.id,
            name: project.name,
          },
        },
        warnings: [],
        nextSteps: [],
      };
    } catch {
      return {
        command: "project.show",
        result: {
          linkedProjectId,
          workspace: null,
          project: null,
        },
        warnings: [],
        nextSteps: [],
      };
    }
  }

  const gateways = createCliUseCaseGateways(context);
  const authUseCases = createAuthUseCases(gateways);
  const projectUseCases = createProjectUseCases(gateways);
  const authState = await authUseCases.whoami();
  const result = await projectUseCases.show(authState);

  return {
    command: "project.show",
    result,
    warnings: [],
    nextSteps: result.linkedProjectId ? (authState.authenticated ? [] : ["prisma-cli auth login"]) : ["prisma-cli project link"],
  };
}

export async function runProjectLink(
  context: CommandContext,
  projectId: string | undefined,
): Promise<CommandSuccess<ProjectShowResult>> {
  if (!projectId && !canPrompt(context)) {
    throw projectSelectionRequiredError();
  }

  if (isRealMode(context)) {
    const authState = await requireAuthenticatedAuthState(context);
    const client = await requireComputeAuth(context.runtime.env);
    const workspace = authState.workspace;

    if (!client || !workspace) {
      throw authRequiredError();
    }

    let selectedProject:
      | {
          id: string;
          name: string;
          workspace: {
            id: string;
            name: string;
          };
        }
      | undefined;

    if (projectId) {
      try {
        const { data } = await client.GET("/v1/projects/{id}", {
          params: { path: { id: projectId } },
        });

        if (!data?.data || data.data.workspace.id !== workspace.id) {
          throw projectNotFoundError(
            `The project "${projectId}" does not exist in workspace "${workspace.name}".`,
            "Run prisma-cli project list and choose a project id from the active workspace.",
          );
        }

        selectedProject = data.data;
      } catch (error) {
        if (error instanceof CliError) {
          throw error;
        }

        throw projectNotFoundError(
          `The project "${projectId}" does not exist in workspace "${workspace.name}".`,
          "Run prisma-cli project list and choose a project id from the active workspace.",
        );
      }
    } else {
      const { data: projectsData } = await client.GET("/v1/projects", {});
      const projects = (projectsData?.data ?? [])
        .filter((project) => project.workspace.id === workspace.id)
        .map((project) => ({
          id: project.id,
          name: project.name,
          workspace: project.workspace,
        }))
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

      if (projects.length === 0) {
        throw projectNotFoundError(
          `No projects are available in workspace "${workspace.name}".`,
          "Use prisma-cli app deploy to create project context, or switch workspaces and try again.",
          [],
        );
      }

      const prompt = createSelectPromptPort(context);
      selectedProject = await prompt.select({
        message: "Select a project",
        choices: projects.map((project) => ({
          label: `${project.name} (${project.id})`,
          value: project,
        })),
      });
    }

    try {
      await writeLinkedProjectId(context.runtime.cwd, selectedProject.id);
    } catch (error) {
      if (error instanceof UnsafeConfigWriteError) {
        throw usageError(
          "Project link requires a writable Prisma config",
          error.message,
          "Update prisma.config.ts to use a recognizable project field, or remove it and rerun prisma-cli project link.",
          ["prisma-cli project link proj_123"],
          "project",
        );
      }

      throw error;
    }

    return {
      command: "project.link",
      result: {
        linkedProjectId: selectedProject.id,
        workspace: {
          id: selectedProject.workspace.id,
          name: selectedProject.workspace.name,
        },
        project: {
          id: selectedProject.id,
          name: selectedProject.name,
        },
      },
      warnings: [],
      nextSteps: ["prisma-cli project show", "prisma-cli app deploy"],
    };
  }

  const gateways = createCliUseCaseGateways(context);
  const projectUseCases = createProjectUseCases(gateways);
  const authState = await requireAuthenticatedAuthState(context);
  const resolvedProjectId = projectId ?? (await resolveProjectIdForLink(context, authState, projectUseCases));
  const result = await projectUseCases.link(authState, resolvedProjectId);

  return {
    command: "project.link",
    result,
    warnings: [],
    nextSteps: ["prisma-cli project show", "prisma-cli app deploy"],
  };
}

async function resolveProjectIdForLink(
  context: CommandContext,
  authState: AuthStateResult,
  projectUseCases: ReturnType<typeof createProjectUseCases>,
): Promise<string> {
  if (!authState.workspace) {
    throw projectSelectionRequiredError();
  }

  const projects = await projectUseCases.listProjectsForWorkspace(authState.workspace.id);

  if (projects.length === 0) {
    throw projectNotFoundError(
      `No projects are available in workspace "${authState.workspace.name}".`,
      "Use prisma-cli app deploy to create project context, or switch workspaces and try again.",
      [],
    );
  }

  const prompt = createSelectPromptPort(context);
  const selectedProject = await prompt.select({
    message: "Select a project",
    choices: projects.map((project) => ({
      label: `${project.name} (${project.id})`,
      value: project,
    })),
  });

  return selectedProject.id;
}

function projectSelectionRequiredError() {
  return usageError(
    "Project link requires a project target in non-interactive mode",
    "This command cannot prompt for project selection in the current mode.",
    "Re-run prisma-cli project link in a TTY, or pass a project id explicitly.",
    ["prisma-cli project list"],
    "project",
  );
}
