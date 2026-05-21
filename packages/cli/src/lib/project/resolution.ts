import { readFile } from "node:fs/promises";
import path from "node:path";

import { CliError } from "../../shell/errors";
import { canPrompt, type CommandContext } from "../../shell/runtime";
import type { AuthWorkspace } from "../../types/auth";
import type { ProjectResolution, ProjectSource, ProjectSummary } from "../../types/project";
import type { SelectPromptPort } from "../../use-cases/contracts";

export interface ProjectCandidate extends ProjectSummary {
  slug?: string | null;
  workspace: AuthWorkspace;
}

export interface ResolvedProjectTarget {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  resolution: ProjectResolution;
}

export interface ResolveProjectOptions {
  context: CommandContext;
  workspace: AuthWorkspace;
  explicitProject?: string;
  listProjects(): Promise<ProjectCandidate[]>;
  createProject?: (name: string) => Promise<ProjectCandidate>;
  prompt?: SelectPromptPort;
  allowCreate?: boolean;
  remember?: boolean;
}

export async function resolveProjectTarget(options: ResolveProjectOptions): Promise<ResolvedProjectTarget> {
  const projects = await options.listProjects();

  if (options.explicitProject) {
    return rememberIfRequested(
      options,
      resolveExplicitProject(options.explicitProject, projects, options.workspace),
      "explicit",
    );
  }

  const platformMapping = await resolveDurablePlatformMapping();
  if (platformMapping) {
    return rememberIfRequested(options, platformMapping, "platform-mapping");
  }

  const remembered = await options.context.stateStore.readRememberedProject(options.workspace.id);
  let staleRemembered = false;
  if (remembered) {
    const matched = projects.find((project) => project.id === remembered.id);
    if (matched) {
      return rememberIfRequested(options, matched, "remembered-local");
    }
    staleRemembered = true;
  }

  const packageName = await readPackageName(options.context.runtime.cwd);
  if (packageName) {
    const matches = projects.filter((project) => projectMatchesPackageName(project, packageName));
    if (matches.length === 1) {
      return rememberIfRequested(options, matches[0], "package-name");
    }
    if (matches.length > 1) {
      return resolveAmbiguousProject(options, matches, "package-name");
    }
  }

  if (options.allowCreate && options.createProject) {
    const inferredName = packageName ?? path.basename(options.context.runtime.cwd);
    if (inferredName) {
      const existing = projects.filter((project) => projectMatchesPackageName(project, inferredName));
      if (existing.length === 1) {
        return rememberIfRequested(options, existing[0], "package-name");
      }
      if (existing.length > 1) {
        return resolveAmbiguousProject(options, existing, "package-name");
      }

      const created = await options.createProject(inferredName);
      return rememberIfRequested(options, created, "created");
    }
  }

  if (options.prompt && canPrompt(options.context) && projects.length > 0) {
    const selected = await options.prompt.select({
      message: "Select a project",
      choices: sortProjects(projects).map((project) => ({
        label: `${project.name} (${project.id})`,
        value: project,
      })),
    });
    return rememberIfRequested(options, selected, "prompt");
  }

  if (staleRemembered && projects.length > 1) {
    throw localStateStaleError();
  }

  throw projectUnresolvedError();
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

export function projectUnresolvedError(): CliError {
  return new CliError({
    code: "PROJECT_UNRESOLVED",
    domain: "project",
    summary: "No project is resolved for this directory",
    why: "No project could be resolved from explicit input, platform mappings, remembered local context, or package metadata.",
    fix: "Pass --project <id-or-name> on the command that needs a project, or add a package.json name that matches an accessible project.",
    exitCode: 1,
    nextSteps: ["prisma-cli project list", "prisma-cli project show --project <id-or-name>"],
  });
}

export function localStateStaleError(): CliError {
  return new CliError({
    code: "LOCAL_STATE_STALE",
    domain: "project",
    summary: "Remembered project context is stale",
    why: "The remembered project is no longer available in the selected workspace, and automatic resolution would be ambiguous.",
    fix: "Pass --project <id-or-name> to choose the project explicitly.",
    exitCode: 1,
    nextSteps: ["prisma-cli project list"],
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

function resolveAmbiguousProject(
  options: ResolveProjectOptions,
  matches: ProjectCandidate[],
  projectRef: string,
): Promise<ResolvedProjectTarget> {
  if (options.prompt && canPrompt(options.context)) {
    return options.prompt
      .select({
        message: "Select a project",
        choices: sortProjects(matches).map((project) => ({
          label: `${project.name} (${project.id})`,
          value: project,
        })),
      })
      .then((selected) => rememberIfRequested(options, selected, "prompt"));
  }

  throw projectAmbiguousError(projectRef, matches);
}

function projectMatchesPackageName(project: ProjectCandidate, packageName: string): boolean {
  return project.id === packageName || project.name === packageName || project.slug === packageName;
}

async function resolveDurablePlatformMapping(): Promise<ProjectCandidate | null> {
  return null;
}

async function rememberIfRequested(
  options: ResolveProjectOptions,
  project: ProjectCandidate,
  projectSource: ProjectSource,
): Promise<ResolvedProjectTarget> {
  if (options.remember) {
    await options.context.stateStore.setRememberedProject({
      id: project.id,
      name: project.name,
      workspaceId: options.workspace.id,
    });
  }

  return {
    workspace: options.workspace,
    project: toProjectSummary(project),
    resolution: {
      projectSource,
    },
  };
}

function toProjectSummary(project: Pick<ProjectCandidate, "id" | "name">): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
  };
}
