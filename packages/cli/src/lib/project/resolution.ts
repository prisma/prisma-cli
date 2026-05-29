import { readFile } from "node:fs/promises";
import path from "node:path";

import { CliError } from "../../shell/errors";
import type { CommandContext } from "../../shell/runtime";
import type { AuthWorkspace } from "../../types/auth";
import type {
  BoundProjectShowResult,
  ProjectResolution,
  ProjectSetupSuggestion,
  ProjectSource,
  ProjectSummary,
  ProjectShowResult,
} from "../../types/project";
import { LOCAL_RESOLUTION_PIN_RELATIVE_PATH, readLocalResolutionPin } from "./local-pin";

export interface ProjectCandidate extends ProjectSummary {
  slug?: string | null;
  workspace: AuthWorkspace;
}

export interface ResolvedProjectTarget {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  resolution: ProjectResolution;
}

export type InferredTargetNameSource = "package-name" | "directory-name";

export interface InferredTargetName {
  name: string;
  source: InferredTargetNameSource;
}

export interface ResolveProjectOptions {
  context: CommandContext;
  workspace: AuthWorkspace;
  explicitProject?: string;
  envProjectId?: string;
  commandName?: string;
  listProjects(): Promise<ProjectCandidate[]>;
}

export async function resolveProjectTarget(options: ResolveProjectOptions): Promise<ResolvedProjectTarget> {
  const projects = await options.listProjects();

  if (options.explicitProject) {
    return resolvedTarget(options.workspace, resolveExplicitProject(options.explicitProject, projects, options.workspace), "explicit", {
      targetName: options.explicitProject,
      targetNameSource: "explicit",
    });
  }

  if (options.envProjectId) {
    const project = projects.find((candidate) => candidate.id === options.envProjectId);
    if (!project) {
      throw projectNotFoundError(options.envProjectId, options.workspace);
    }
    return resolvedTarget(options.workspace, project, "env", {
      targetName: options.envProjectId,
      targetNameSource: "env",
    });
  }

  const localPin = await readLocalResolutionPin(options.context.runtime.cwd);
  if (localPin.kind === "invalid") {
    throw localStateStaleError();
  }
  if (localPin.kind === "present") {
    if (localPin.pin.workspaceId !== options.workspace.id) {
      throw localStateStaleError();
    }

    const project = projects.find((candidate) => candidate.id === localPin.pin.projectId);
    if (!project) {
      throw localStateStaleError();
    }

    return resolvedTarget(options.workspace, project, "local-pin", {
      targetName: project.name,
      targetNameSource: "local-pin",
    });
  }

  const platformMapping = await resolveDurablePlatformMapping();
  if (platformMapping && platformMapping.workspace.id === options.workspace.id) {
    return resolvedTarget(options.workspace, platformMapping, "platform-mapping", {
      targetName: platformMapping.name,
      targetNameSource: "platform-mapping",
    });
  }

  throw await projectSetupRequiredError({
    cwd: options.context.runtime.cwd,
    projects,
    commandName: options.commandName,
  });
}

export async function inspectProjectBinding(options: ResolveProjectOptions): Promise<ProjectShowResult> {
  const projects = await options.listProjects();

  if (options.explicitProject) {
    return resolvedTarget(options.workspace, resolveExplicitProject(options.explicitProject, projects, options.workspace), "explicit", {
      targetName: options.explicitProject,
      targetNameSource: "explicit",
    });
  }

  const localPin = await readLocalResolutionPin(options.context.runtime.cwd);
  if (localPin.kind === "invalid") {
    throw localStateStaleError();
  }
  if (localPin.kind === "present") {
    if (localPin.pin.workspaceId !== options.workspace.id) {
      throw localStateStaleError();
    }

    const project = projects.find((candidate) => candidate.id === localPin.pin.projectId);
    if (!project) {
      throw localStateStaleError();
    }

    return resolvedTarget(options.workspace, project, "local-pin", {
      targetName: project.name,
      targetNameSource: "local-pin",
    });
  }

  const platformMapping = await resolveDurablePlatformMapping();
  if (platformMapping && platformMapping.workspace.id === options.workspace.id) {
    return resolvedTarget(options.workspace, platformMapping, "platform-mapping", {
      targetName: platformMapping.name,
      targetNameSource: "platform-mapping",
    });
  }

  return {
    workspace: options.workspace,
    project: null,
    resolution: {
      projectSource: "unbound",
    },
    ...await buildProjectSetupSuggestion({
      cwd: options.context.runtime.cwd,
      projects,
      commandName: options.commandName ?? "project show",
    }),
  };
}

export function projectNotFoundError(projectRef: string, workspace: AuthWorkspace): CliError {
  return new CliError({
    code: "PROJECT_NOT_FOUND",
    domain: "project",
    summary: "Project not found",
    why: `The project "${projectRef}" does not exist in workspace "${workspace.name}" or is not accessible.`,
    fix: "Pass a project id or name from prisma-cli project list.",
    exitCode: 1,
    nextSteps: ["prisma-cli project list"],
  });
}

export function projectAmbiguousError(projectRef: string | null, matches: ProjectCandidate[]): CliError {
  const firstMatch = matches[0];
  const nextSteps = ["prisma-cli project list"];
  if (firstMatch) {
    // Surface the matched id verbatim so the user can see the exact
    // shape of the disambiguation flag instead of guessing.
    nextSteps.push(`prisma-cli app deploy --project ${firstMatch.id}`);
  }

  return new CliError({
    code: "PROJECT_AMBIGUOUS",
    domain: "project",
    summary: "Project resolution is ambiguous",
    why: projectRef
      ? `Multiple projects matched "${projectRef}".`
      : "Multiple projects matched the current directory context.",
    fix: "Pass --project <id-or-name> to choose the project explicitly.",
    meta: {
      matches: matches.map((project) => ({ id: project.id, name: project.name })),
    },
    exitCode: 1,
    nextSteps,
  });
}

export function localStateStaleError(): CliError {
  return new CliError({
    code: "LOCAL_STATE_STALE",
    domain: "project",
    summary: "Local project binding is stale",
    why: `The target recorded in ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} is no longer available in the selected workspace.`,
    fix: `Delete ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH}, then choose a Project explicitly.`,
    meta: {
      pinPath: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
    },
    exitCode: 1,
    nextSteps: ["prisma-cli project list", "prisma-cli project link <id-or-name>"],
  });
}

export async function buildProjectSetupSuggestion(options: {
  cwd: string;
  projects: ProjectCandidate[];
  commandName?: string;
}): Promise<ProjectSetupSuggestion> {
  const suggestedName = await inferTargetName(options.cwd);
  const candidates = sortProjects(
    options.projects.filter((project) => projectMatchesSuggestedName(project, suggestedName.name)),
  ).map(toProjectSummary);

  return {
    suggestedProjectName: suggestedName.name,
    suggestedProjectNameSource: suggestedName.source,
    candidates,
    recoveryCommands: buildProjectRecoveryCommands(options.commandName),
  };
}

export async function projectSetupRequiredError(options: {
  cwd: string;
  projects: ProjectCandidate[];
  commandName?: string;
}): Promise<CliError> {
  const suggestion = await buildProjectSetupSuggestion(options);
  const commandLabel = options.commandName ? `prisma-cli ${options.commandName}` : "this command";

  return new CliError({
    code: "PROJECT_SETUP_REQUIRED",
    domain: "project",
    summary: "Choose a Project before running this command",
    why: `This directory is not linked to a Prisma Project, and ${commandLabel} will not choose one from package or directory names.`,
    fix: "Link the directory to an existing Project, or pass --project <id-or-name> for this command.",
    meta: suggestion,
    exitCode: 1,
    nextSteps: ["prisma-cli project list", ...suggestion.recoveryCommands],
  });
}

export async function readPackageName(cwd: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const packageName = "name" in parsed ? parsed.name : null;
    return typeof packageName === "string" && packageName.trim().length > 0 ? packageName.trim() : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function inferTargetName(cwd: string): Promise<InferredTargetName> {
  const packageName = await readPackageName(cwd);
  if (packageName && isValidInferredTargetName(packageName)) {
    return {
      name: packageName,
      source: "package-name",
    };
  }

  return {
    name: path.basename(cwd),
    source: "directory-name",
  };
}

function isValidInferredTargetName(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

export function sortProjects<T extends Pick<ProjectCandidate, "id" | "name">>(projects: T[]): T[] {
  return projects
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function resolveExplicitProject(
  projectRef: string,
  projects: ProjectCandidate[],
  workspace: AuthWorkspace,
): ProjectCandidate {
  const matches = projects.filter((project) => project.id === projectRef || project.name === projectRef);
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw projectAmbiguousError(projectRef, matches);
  }
  throw projectNotFoundError(projectRef, workspace);
}

function projectMatchesSuggestedName(project: ProjectCandidate, suggestedName: string): boolean {
  return project.id === suggestedName || project.name === suggestedName || project.slug === suggestedName;
}

export async function resolveDurablePlatformMapping(): Promise<ProjectCandidate | null> {
  return null;
}

function resolvedTarget(
  workspace: AuthWorkspace,
  project: ProjectCandidate,
  projectSource: ProjectSource,
  resolutionDetails?: Omit<ProjectResolution, "projectSource">,
): BoundProjectShowResult {
  return {
    workspace,
    project: toProjectSummary(project),
    resolution: {
      projectSource,
      ...resolutionDetails,
    },
  };
}

function buildProjectRecoveryCommands(commandName: string | undefined): string[] {
  const commands = ["prisma-cli project link <id-or-name>"];
  if (commandName) {
    commands.push(`prisma-cli ${commandName} --project <id-or-name>`);
  }
  return commands;
}

function toProjectSummary(project: Pick<ProjectCandidate, "id" | "name">): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
  };
}
