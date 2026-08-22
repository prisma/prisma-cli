import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  matchError,
  Result,
  TaggedError,
  type UnhandledException,
} from "better-result";

import { formatCommandArgument } from "../../command-arguments";
import { CliError } from "../../errors";
import type { NextAction } from "../../next-actions";
import type { AuthWorkspace } from "../../types/auth";
import type {
  BoundProjectShowResult,
  ProjectResolution,
  ProjectSetupSuggestion,
  ProjectShowResult,
  ProjectSource,
  ProjectSummary,
} from "../../types/project";
import { sameWorkspaceId } from "../workspace-id";
import {
  LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
  type LocalResolutionPinReadAbortedError,
  type LocalResolutionPinReadError,
  type LocalResolutionPinReadResult,
  readLocalResolutionPin,
} from "./local-pin";

export interface ProjectCandidate extends ProjectSummary {
  slug?: string | null;
  workspace: AuthWorkspace;
}

export type ResolvedProjectTarget = BoundProjectShowResult;
type BoundProjectSource = Exclude<ProjectSource, "unbound">;

export class ProjectNotFoundError extends TaggedError("ProjectNotFoundError")<{
  message: string;
  projectRef: string;
  workspace: AuthWorkspace;
}>() {
  constructor(projectRef: string, workspace: AuthWorkspace) {
    super({
      message: `Project "${projectRef}" was not found in workspace "${workspace.name}".`,
      projectRef,
      workspace,
    });
  }
}

export class ProjectAmbiguousError extends TaggedError(
  "ProjectAmbiguousError",
)<{
  message: string;
  projectRef: string | null;
  matches: ProjectCandidate[];
}>() {
  constructor(projectRef: string | null, matches: ProjectCandidate[]) {
    super({
      message: projectRef
        ? `Multiple projects matched "${projectRef}".`
        : "Multiple projects matched the current directory context.",
      projectRef,
      matches,
    });
  }
}

export class LocalStateStaleError extends TaggedError("LocalStateStaleError")<{
  message: string;
  pinPath: string;
}>() {
  constructor() {
    super({
      message: `The target recorded in ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} is no longer available in the selected workspace.`,
      pinPath: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
    });
  }
}

export class LocalProjectWorkspaceMismatchError extends TaggedError(
  "LocalProjectWorkspaceMismatchError",
)<{
  message: string;
  pinnedWorkspaceId: string;
  pinnedProjectId: string;
  activeWorkspace: AuthWorkspace;
}>() {
  constructor(options: {
    pinnedWorkspaceId: string;
    pinnedProjectId: string;
    activeWorkspace: AuthWorkspace;
  }) {
    super({
      message: `${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} links this directory to project ${options.pinnedProjectId} in workspace ${options.pinnedWorkspaceId}, but the active workspace is "${options.activeWorkspace.name}" (${options.activeWorkspace.id}).`,
      pinnedWorkspaceId: options.pinnedWorkspaceId,
      pinnedProjectId: options.pinnedProjectId,
      activeWorkspace: options.activeWorkspace,
    });
  }
}

export class ProjectSetupRequiredError extends TaggedError(
  "ProjectSetupRequiredError",
)<{
  message: string;
  commandName?: string;
  suggestion: ProjectSetupSuggestion;
}>() {
  constructor(options: {
    commandName?: string;
    suggestion: ProjectSetupSuggestion;
  }) {
    const commandLabel = options.commandName
      ? `prisma-cli ${options.commandName}`
      : "this command";
    super({
      message: `This directory is not linked to a Prisma Project, and ${commandLabel} will not choose one from package or directory names.`,
      commandName: options.commandName,
      suggestion: options.suggestion,
    });
  }
}

export type ProjectResolutionError =
  | ProjectNotFoundError
  | ProjectAmbiguousError
  | ProjectSetupRequiredError
  | LocalStateStaleError
  | LocalProjectWorkspaceMismatchError
  | LocalResolutionPinReadAbortedError
  | UnhandledException;

export type InferredTargetNameSource = "package-name" | "directory-name";

export interface InferredTargetName {
  name: string;
  source: InferredTargetNameSource;
}

/**
 * What project resolution reads from its caller: where the command was
 * invoked, and the run's abort signal. Deliberately not the shell's
 * CommandContext — resolution needs neither its output streams nor its
 * flags, and typing it that way forced every other caller to be, or to
 * impersonate, the shell.
 */
export interface ProjectResolutionContext {
  runtime: { cwd: string; signal: AbortSignal };
}

export interface ResolveProjectOptions {
  context: ProjectResolutionContext;
  workspace: AuthWorkspace;
  explicitProject?: string;
  commandName?: string;
  listProjects(): Promise<ProjectCandidate[]>;
}

export async function resolveProjectTarget(
  options: ResolveProjectOptions,
): Promise<Result<ResolvedProjectTarget, ProjectResolutionError>> {
  return Result.gen(async function* () {
    const localPin = yield* Result.await(readImplicitLocalPin(options));
    const projects = await options.listProjects();
    const target = yield* Result.await(
      resolveBoundProjectTarget(options, projects, { localPin }),
    );

    if (target) {
      return Result.ok(target);
    }

    return Result.err(
      await projectSetupRequiredError({
        cwd: options.context.runtime.cwd,
        projects,
        commandName: options.commandName,
        signal: options.context.runtime.signal,
      }),
    );
  });
}

export async function inspectProjectBinding(
  options: ResolveProjectOptions,
): Promise<Result<ProjectShowResult, ProjectResolutionError>> {
  return Result.gen(async function* () {
    const localPin = yield* Result.await(readImplicitLocalPin(options));
    const projects = await options.listProjects();
    const target = yield* Result.await(
      resolveBoundProjectTarget(options, projects, { localPin }),
    );

    if (target) {
      return Result.ok(target);
    }

    return Result.ok({
      workspace: options.workspace,
      project: null,
      localBinding: {
        status: "not-linked",
      },
      resolution: {
        projectSource: "unbound",
      },
      ...(await buildProjectSetupSuggestion({
        cwd: options.context.runtime.cwd,
        projects,
        commandName: options.commandName ?? "project show",
        signal: options.context.runtime.signal,
      })),
    } satisfies ProjectShowResult);
  });
}

export function projectNotFoundError(
  projectRef: string,
  workspace: AuthWorkspace,
): CliError {
  return projectResolutionErrorToCliError(
    new ProjectNotFoundError(projectRef, workspace),
  );
}

function projectNotFoundCliError(
  projectRef: string,
  workspace: AuthWorkspace,
): CliError {
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

export function projectAmbiguousError(
  projectRef: string | null,
  matches: ProjectCandidate[],
): CliError {
  return projectResolutionErrorToCliError(
    new ProjectAmbiguousError(projectRef, matches),
  );
}

function projectAmbiguousCliError(
  projectRef: string | null,
  matches: ProjectCandidate[],
): CliError {
  const firstMatch = matches[0];
  const nextSteps = ["prisma-cli project list"];
  if (firstMatch) {
    // Surface the matched id verbatim so the user can copy the exact
    // shape of a disambiguating reference instead of guessing.
    nextSteps.push(`prisma-cli project link ${firstMatch.id}`);
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
      matches: matches.map((project) => ({
        id: project.id,
        name: project.name,
      })),
    },
    exitCode: 1,
    nextSteps,
  });
}

function localStateStaleCliError(): CliError {
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
    nextSteps: [
      "prisma-cli project list",
      "prisma-cli project link <id-or-name>",
    ],
  });
}

function localProjectWorkspaceMismatchCliError(options: {
  pinnedWorkspaceId: string;
  pinnedProjectId: string;
  activeWorkspace: AuthWorkspace;
}): CliError {
  return new CliError({
    code: "LOCAL_PROJECT_WORKSPACE_MISMATCH",
    domain: "project",
    summary: "Project link uses another workspace",
    why: `${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} links this directory to project ${options.pinnedProjectId} in workspace ${options.pinnedWorkspaceId}, but your current CLI session is workspace "${options.activeWorkspace.name}" (${options.activeWorkspace.id}).`,
    fix: "Switch to the linked workspace, or relink this directory to a project in the current workspace.",
    meta: {
      pinPath: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
      pinnedWorkspaceId: options.pinnedWorkspaceId,
      pinnedProjectId: options.pinnedProjectId,
      activeWorkspaceId: options.activeWorkspace.id,
      activeWorkspaceName: options.activeWorkspace.name,
    },
    exitCode: 1,
    nextSteps: [
      `prisma-cli auth workspace use ${options.pinnedWorkspaceId}`,
      "prisma-cli project list",
      "prisma-cli project link <id-or-name>",
    ],
  });
}

/**
 * Converts expected project-resolution variants to command-boundary CliErrors.
 * `LocalResolutionPinReadAbortedError` and `UnhandledException` intentionally
 * propagate as exceptions; callers such as `resolveProjectShowInRealMode`
 * throw this helper's result, so passthrough variants should keep bubbling.
 */
export function projectResolutionErrorToCliError(
  error: ProjectResolutionError,
): CliError {
  return matchError(error, {
    ProjectNotFoundError: (error) =>
      projectNotFoundCliError(error.projectRef, error.workspace),
    ProjectAmbiguousError: (error) =>
      projectAmbiguousCliError(error.projectRef, error.matches),
    ProjectSetupRequiredError: (error) => projectSetupRequiredCliError(error),
    LocalStateStaleError: () => localStateStaleCliError(),
    LocalProjectWorkspaceMismatchError: (error) =>
      localProjectWorkspaceMismatchCliError({
        pinnedWorkspaceId: error.pinnedWorkspaceId,
        pinnedProjectId: error.pinnedProjectId,
        activeWorkspace: error.activeWorkspace,
      }),
    LocalResolutionPinReadAbortedError: (error) => {
      throw error;
    },
    UnhandledException: (error) => {
      throw error;
    },
  });
}

export async function buildProjectSetupSuggestion(options: {
  cwd: string;
  projects: ProjectCandidate[];
  commandName?: string;
  signal?: AbortSignal;
}): Promise<ProjectSetupSuggestion> {
  const suggestedName = await inferTargetName(options.cwd, options.signal);
  const candidates = sortProjects(
    options.projects.filter((project) =>
      projectMatchesSuggestedName(project, suggestedName.name),
    ),
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
  signal?: AbortSignal;
}): Promise<ProjectSetupRequiredError> {
  const suggestion = await buildProjectSetupSuggestion(options);
  return new ProjectSetupRequiredError({
    commandName: options.commandName,
    suggestion,
  });
}

function projectSetupRequiredCliError(
  error: ProjectSetupRequiredError,
): CliError {
  const suggestion = error.suggestion;
  return new CliError({
    code: "PROJECT_SETUP_REQUIRED",
    domain: "project",
    summary: "Choose a Project before running this command",
    why: error.message,
    fix: "Link the directory to an existing Project, or pass --project <id-or-name> for this command.",
    meta: { ...suggestion },
    exitCode: 1,
    nextSteps: ["prisma-cli project list", ...suggestion.recoveryCommands],
    nextActions: buildProjectSetupNextActions({
      commandName: error.commandName,
      suggestedProjectName: suggestion.suggestedProjectName,
    }),
  });
}

export function buildProjectSetupNextActions(
  options: {
    commandName?: string;
    suggestedProjectName?: string;
    createCommand?: string;
    reason?: string;
    /** The explicit-target retry line, for commands whose grammar the
     *  generic `--project <id-or-name>` template does not fit. */
    retryCommand?: string;
  } = {},
): NextAction[] {
  const recoveryCommands = buildProjectRecoveryCommands(options.commandName);
  const linkCommand =
    recoveryCommands[0] ?? "prisma-cli project link <id-or-name>";
  const retryCommand = options.retryCommand ?? recoveryCommands[1];
  const commands = [
    "prisma-cli project list",
    linkCommand,
    ...(retryCommand ? [retryCommand] : []),
  ];

  const actions: NextAction[] = [
    {
      kind: "user-choice",
      journey: "project-setup",
      label:
        "Ask the user whether to link an existing Project or create a new one",
      commands,
      reason:
        options.reason ??
        "This directory is not linked to a Prisma Project. Package and directory names are suggestions only, not a safe Project selection.",
    },
    {
      kind: "run-command",
      journey: "project-setup",
      label: "Link the chosen Project",
      command: linkCommand,
      reason:
        "Linking writes the durable local Project binding for this directory.",
    },
  ];

  const createCommand =
    options.createCommand ??
    (options.suggestedProjectName
      ? `prisma-cli project create ${formatCommandArgument(options.suggestedProjectName)}`
      : undefined);
  if (createCommand) {
    actions.push({
      kind: "run-command",
      journey: "project-setup",
      label: "Create and link a new Project",
      command: createCommand,
      reason:
        "Use this when the user wants a new Prisma Project instead of an existing one.",
    });
  }

  if (options.commandName) {
    actions.push({
      kind: "run-command",
      journey: "recover",
      label: "Retry with an explicit Project",
      command:
        retryCommand ??
        `prisma-cli ${options.commandName} --project <id-or-name>`,
    });
  }

  return actions;
}

export async function readPackageName(
  cwd: string,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  try {
    const raw = await readFile(path.join(cwd, "package.json"), {
      encoding: "utf8",
      signal,
    });
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const packageName = "name" in parsed ? parsed.name : null;
    return typeof packageName === "string" && packageName.trim().length > 0
      ? packageName.trim()
      : null;
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

export async function inferTargetName(
  cwd: string,
  signal?: AbortSignal,
): Promise<InferredTargetName> {
  const packageName = await readPackageName(cwd, signal);
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

const INFERRED_TARGET_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function isValidInferredTargetName(value: string): boolean {
  return INFERRED_TARGET_NAME.test(value);
}

export function sortProjects<T extends Pick<ProjectCandidate, "id" | "name">>(
  projects: T[],
): T[] {
  return projects
    .slice()
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
}

function resolveExplicitProject(
  projectRef: string,
  projects: ProjectCandidate[],
  workspace: AuthWorkspace,
): Result<ProjectCandidate, ProjectNotFoundError | ProjectAmbiguousError> {
  // The stable id is primary and the name is the fallback, so a project
  // named like another project's id can never shadow it or make it
  // ambiguous.
  const byId = projects.filter((project) => project.id === projectRef);
  const matches =
    byId.length > 0
      ? byId
      : projects.filter((project) => project.name === projectRef);
  if (matches.length === 1) {
    return Result.ok(matches[0]);
  }
  if (matches.length > 1) {
    return Result.err(new ProjectAmbiguousError(projectRef, matches));
  }
  return Result.err(new ProjectNotFoundError(projectRef, workspace));
}

function projectMatchesSuggestedName(
  project: ProjectCandidate,
  suggestedName: string,
): boolean {
  return (
    project.id === suggestedName ||
    project.name === suggestedName ||
    project.slug === suggestedName
  );
}

export async function resolveDurablePlatformMapping(): Promise<ProjectCandidate | null> {
  return null;
}

async function resolveBoundProjectTarget(
  options: ResolveProjectOptions,
  projects: ProjectCandidate[],
  settings: {
    localPin: LocalResolutionPinReadResult | null;
  },
): Promise<Result<BoundProjectShowResult | null, ProjectResolutionError>> {
  if (options.explicitProject) {
    const projectResult = resolveExplicitProject(
      options.explicitProject,
      projects,
      options.workspace,
    );
    if (projectResult.isErr()) {
      return Result.err(projectResult.error);
    }
    return Result.ok(
      resolvedTarget(options.workspace, projectResult.value, "explicit", {
        targetName: options.explicitProject,
        targetNameSource: "explicit",
      }),
    );
  }

  const localPin = settings.localPin;
  if (!localPin) {
    return Result.ok(null);
  }
  if (localPin.kind === "present") {
    if (!sameWorkspaceId(localPin.pin.workspaceId, options.workspace.id)) {
      return Result.err(
        new LocalProjectWorkspaceMismatchError({
          pinnedWorkspaceId: localPin.pin.workspaceId,
          pinnedProjectId: localPin.pin.projectId,
          activeWorkspace: options.workspace,
        }),
      );
    }

    const project = projects.find(
      (candidate) => candidate.id === localPin.pin.projectId,
    );
    if (!project) {
      return Result.err(new LocalStateStaleError());
    }

    return Result.ok(
      resolvedTarget(options.workspace, project, "local-pin", {
        targetName: project.name,
        targetNameSource: "local-pin",
      }),
    );
  }

  const platformMapping = await resolveDurablePlatformMapping();
  if (
    platformMapping &&
    sameWorkspaceId(platformMapping.workspace.id, options.workspace.id)
  ) {
    return Result.ok(
      resolvedTarget(options.workspace, platformMapping, "platform-mapping", {
        targetName: platformMapping.name,
        targetNameSource: "platform-mapping",
      }),
    );
  }

  return Result.ok(null);
}

async function readImplicitLocalPin(
  options: ResolveProjectOptions,
): Promise<
  Result<LocalResolutionPinReadResult | null, ProjectResolutionError>
> {
  if (options.explicitProject) {
    return Result.ok(null);
  }

  const localPinResult = await readLocalResolutionPin(
    options.context.runtime.cwd,
    options.context.runtime.signal,
  );
  if (localPinResult.isErr()) {
    return Result.err(localPinReadErrorToProjectError(localPinResult.error));
  }

  const localPin = localPinResult.value;
  if (
    localPin.kind === "present" &&
    !sameWorkspaceId(localPin.pin.workspaceId, options.workspace.id)
  ) {
    return Result.err(
      new LocalProjectWorkspaceMismatchError({
        pinnedWorkspaceId: localPin.pin.workspaceId,
        pinnedProjectId: localPin.pin.projectId,
        activeWorkspace: options.workspace,
      }),
    );
  }

  return Result.ok(localPin);
}

function localPinReadErrorToProjectError(
  error: LocalResolutionPinReadError,
): ProjectResolutionError {
  return matchError(error, {
    LocalResolutionPinInvalidJsonError: () => new LocalStateStaleError(),
    LocalResolutionPinInvalidShapeError: () => new LocalStateStaleError(),
    LocalResolutionPinReadAbortedError: (error) => error,
    UnhandledException: (error) => error,
  });
}

function resolvedTarget(
  workspace: AuthWorkspace,
  project: ProjectCandidate,
  projectSource: BoundProjectSource,
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

function buildProjectRecoveryCommands(
  commandName: string | undefined,
): string[] {
  const commands = ["prisma-cli project link <id-or-name>"];
  if (commandName) {
    commands.push(`prisma-cli ${commandName} --project <id-or-name>`);
  }
  return commands;
}

function toProjectSummary(
  project: Pick<ProjectCandidate, "id" | "name" | "url" | "defaultRegion">,
): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    ...(project.url ? { url: project.url } : {}),
    ...(project.defaultRegion != null
      ? { defaultRegion: project.defaultRegion }
      : {}),
  };
}
