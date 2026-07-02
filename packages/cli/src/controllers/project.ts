import { unlink } from "node:fs/promises";
import path from "node:path";

import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { matchError } from "better-result";
import open from "open";

import {
  type GitHubRepositoryReference,
  parseGitHubRepositoryUrl,
  readGitOriginRemote,
} from "../adapters/git";
import {
  FileTokenStorage,
  WorkspaceSelectionError,
} from "../adapters/token-storage";
import {
  type PrismaCliPackageCommandFormatter,
  resolvePrismaCliPackageCommandFormatterSync,
} from "../lib/agent/cli-command";
import { createAppProvider } from "../lib/app/app-provider";
import { SERVICE_TOKEN_ENV_VAR } from "../lib/auth/client";
import { requireComputeAuth } from "../lib/auth/guard";
import {
  RecipientSessionInvalidError,
  resolveRecipientWorkspaceSession,
} from "../lib/auth/recipient";
import { promptForProjectSetupChoice } from "../lib/project/interactive-setup";
import {
  LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
  type LocalResolutionPinReadError,
  readLocalResolutionPin,
  writeLocalResolutionPin,
} from "../lib/project/local-pin";
import {
  createManagementProjectProvider,
  type ProjectProvider,
  projectRemoveBlockedError,
  projectRenameFailedError,
  projectTransferRejectedError,
} from "../lib/project/provider";
import {
  buildProjectSetupNextActions,
  inferTargetName,
  inspectProjectBinding,
  type ProjectCandidate,
  projectResolutionErrorToCliError,
  type ResolvedProjectTarget,
  resolveProjectTarget,
  sortProjects,
} from "../lib/project/resolution";
import {
  bindProjectToDirectory,
  formatCommandArgument,
  isValidProjectSetupName,
  projectCreateFailedError,
  projectDirectoryBindingErrorToCliError,
  projectSetupNameRequiredError,
  resolveProjectForSetup,
  toProjectSummary,
} from "../lib/project/setup";
import {
  authRequiredError,
  CliError,
  featureUnavailableError,
  usageError,
  workspaceAmbiguousError,
  workspaceNotAuthenticatedError,
  workspaceRequiredError,
} from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import { type CommandContext, canPrompt } from "../shell/runtime";
import { renderSummaryLine } from "../shell/ui";
import type { AuthWorkspace } from "../types/auth";
import type {
  GitRepositoryConnection,
  ProjectListResult,
  ProjectRemoveResult,
  ProjectRenameResult,
  ProjectRepositoryConnectionResult,
  ProjectSetupResult,
  ProjectShowResult,
  ProjectSummary,
  ProjectTransferResult,
} from "../types/project";
import { createCliUseCaseGateways } from "../use-cases/create-cli-gateways";
import { createProjectUseCases } from "../use-cases/project";
import { requireAuthenticatedAuthState } from "./auth";

export interface GitConnectOptions {
  project?: string;
}

export interface GitDisconnectOptions {
  project?: string;
}

const GITHUB_INSTALL_POLL_INTERVAL_MS = 2_000;
const GITHUB_INSTALL_POLL_TIMEOUT_MS = 120_000;

function isRealMode(context: CommandContext): boolean {
  return (
    !context.runtime.fixturePath &&
    !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH
  );
}

async function readProjectListLocalBinding(
  cwd: string,
  workspace: AuthWorkspace,
  projects: Array<Pick<ProjectCandidate, "id">>,
  signal: AbortSignal,
): Promise<ProjectListResult["localBinding"]> {
  const pinResult = await readLocalResolutionPin(cwd, signal);
  if (pinResult.isErr()) {
    return localPinReadErrorToInvalidLocalBinding(pinResult.error);
  }

  const pin = pinResult.value;
  if (pin.kind === "present") {
    return pin.pin.workspaceId === workspace.id &&
      projects.some((project) => project.id === pin.pin.projectId)
      ? { status: "linked" }
      : { status: "invalid" };
  }
  return { status: "not-linked" };
}

function localPinReadErrorToInvalidLocalBinding(
  error: LocalResolutionPinReadError,
): ProjectListResult["localBinding"] {
  // Migration bridge: remove in Phase 20 when local-pin read errors are composed before controller output shaping.
  return matchError(error, {
    LocalResolutionPinInvalidJsonError: () => ({ status: "invalid" }),
    LocalResolutionPinInvalidShapeError: () => ({ status: "invalid" }),
    LocalResolutionPinReadAbortedError: (error) => {
      throw error;
    },
    UnhandledException: (error) => {
      throw error;
    },
  });
}

export async function runProjectList(
  context: CommandContext,
): Promise<CommandSuccess<ProjectListResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (isRealMode(context)) {
    const client = await requireComputeAuth(
      context.runtime.env,
      context.runtime.signal,
    );
    if (!client) {
      throw authRequiredError();
    }
    const projects = sortProjects(
      await listRealWorkspaceProjects(
        client,
        workspace,
        context.runtime.signal,
      ),
    );
    const localBinding = await readProjectListLocalBinding(
      context.runtime.cwd,
      workspace,
      projects,
      context.runtime.signal,
    );
    const nextActions = buildProjectListNextActions(localBinding);

    return {
      command: "project.list",
      result: {
        workspace,
        projects: projects.map(toProjectSummary),
        localBinding,
      },
      warnings: [],
      nextSteps: [],
      nextActions,
    };
  }

  const projectUseCases = createProjectUseCases(
    createCliUseCaseGateways(context),
  );
  const result = await projectUseCases.list(authState);
  const localBinding = await readProjectListLocalBinding(
    context.runtime.cwd,
    workspace,
    result.projects,
    context.runtime.signal,
  );
  const nextActions = buildProjectListNextActions(localBinding);

  return {
    command: "project.list",
    result: {
      ...result,
      localBinding,
    },
    warnings: [],
    nextSteps: [],
    nextActions,
  };
}

function buildProjectListNextActions(
  localBinding: ProjectListResult["localBinding"],
) {
  return localBinding?.status === "linked"
    ? []
    : buildProjectSetupNextActions({
        createCommand: "prisma-cli project create <name>",
        reason:
          localBinding?.status === "invalid"
            ? "This directory has an invalid local Project binding. Ask the user which Prisma Project to link before running Project-scoped commands."
            : "This directory is not linked to a Prisma Project. Project list shows available Projects, but none is selected for this directory.",
      });
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
    : await resolveProjectShowInFixtureMode(
        context,
        workspace,
        explicitProject,
      );

  return {
    command: "project.show",
    result,
    warnings: [],
    nextSteps: [],
    nextActions:
      result.project === null
        ? buildProjectSetupNextActions({
            commandName: "project show",
            suggestedProjectName: result.suggestedProjectName,
            reason:
              "This directory is not linked to a Prisma Project. Package and directory names can suggest setup defaults, but they do not select a Project.",
          })
        : [],
  };
}

export async function runProjectCreate(
  context: CommandContext,
  projectName: string,
): Promise<CommandSuccess<ProjectSetupResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (!isValidProjectSetupName(projectName)) {
    throw projectSetupNameRequiredError("project create");
  }

  if (!isRealMode(context)) {
    throw featureUnavailableError(
      "Project create is not available in fixture mode",
      "Creating Projects requires live platform integration.",
      "Rerun without fixture mode enabled to create a Project.",
      ["prisma-cli auth login"],
      "project",
    );
  }

  const client = await requireComputeAuth(
    context.runtime.env,
    context.runtime.signal,
  );
  if (!client) {
    throw authRequiredError();
  }

  const provider = createAppProvider(client);
  const name = projectName.trim();
  const created = await provider
    .createProject({ name, signal: context.runtime.signal })
    .catch((error) => {
      throw projectCreateFailedError(error, name, workspace, {
        nextSteps: [
          "prisma-cli project list",
          "prisma-cli project link <id-or-name>",
        ],
        permissionFix:
          "Grant the token permission to create Projects in this workspace, or link an existing Project.",
        fallbackFix:
          "Retry the command, or choose an existing Project with prisma-cli project link <id-or-name>.",
      });
    });
  const bindResult = await bindProjectToDirectory(
    context,
    workspace,
    {
      id: created.id,
      name: created.name,
    },
    "created",
  );
  if (bindResult.isErr()) {
    throw projectDirectoryBindingErrorToCliError(bindResult.error);
  }
  const result = bindResult.value;

  return {
    command: "project.create",
    result,
    warnings: [],
    nextSteps: ["prisma-cli app deploy"],
  };
}

export async function runProjectLink(
  context: CommandContext,
  projectRef: string | undefined,
): Promise<CommandSuccess<ProjectSetupResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  let provider: ReturnType<typeof createAppProvider> | null = null;
  let projects: ProjectCandidate[];
  if (isRealMode(context)) {
    const client = await requireComputeAuth(
      context.runtime.env,
      context.runtime.signal,
    );
    if (!client) {
      throw authRequiredError();
    }
    provider = createAppProvider(client);
    projects = await listRealWorkspaceProjects(
      client,
      workspace,
      context.runtime.signal,
    );
  } else {
    projects = listFixtureWorkspaceProjects(context, workspace);
  }

  let result: ProjectSetupResult;
  if (projectRef?.trim()) {
    const project = resolveProjectForSetup(
      projectRef.trim(),
      projects,
      workspace,
    );
    result = await requireProjectDirectoryBinding(
      context,
      workspace,
      toProjectSummary(project),
      "linked",
    );
  } else if (canPrompt(context) && !context.flags.yes) {
    result = await resolveInteractiveProjectLinkSetup(
      context,
      workspace,
      projects,
      provider,
    );
  } else {
    throw await projectLinkTargetRequiredError(context, projects);
  }

  return {
    command: "project.link",
    result,
    warnings: [],
    nextSteps: ["prisma-cli app deploy"],
  };
}

async function resolveInteractiveProjectLinkSetup(
  context: CommandContext,
  workspace: AuthWorkspace,
  projects: ProjectCandidate[],
  provider: ReturnType<typeof createAppProvider> | null,
): Promise<ProjectSetupResult> {
  const setup = await promptForProjectSetupChoice({
    context,
    projects,
    createProject: (projectName) => {
      if (!provider) {
        throw featureUnavailableError(
          "Project create is not available in fixture mode",
          "Creating Projects requires live platform integration.",
          "Rerun without fixture mode enabled to create a Project.",
          ["prisma-cli auth login"],
          "project",
        );
      }
      return createProjectForLinkSetup(
        provider,
        projectName,
        workspace,
        context.runtime.signal,
      );
    },
    cancel: {
      why: "Project link needs a Project before it can continue.",
      fix: "Choose an existing Project or create a new one, then rerun project link.",
      nextSteps: [
        "prisma-cli project link <id-or-name>",
        "prisma-cli project create <name>",
      ],
    },
  });

  return requireProjectDirectoryBinding(
    context,
    workspace,
    setup.project,
    setup.action,
  );
}

async function requireProjectDirectoryBinding(
  context: CommandContext,
  workspace: AuthWorkspace,
  project: ProjectSummary,
  action: ProjectSetupResult["action"],
): Promise<ProjectSetupResult> {
  const bindResult = await bindProjectToDirectory(
    context,
    workspace,
    project,
    action,
  );
  if (bindResult.isErr()) {
    throw projectDirectoryBindingErrorToCliError(bindResult.error);
  }

  return bindResult.value;
}

async function createProjectForLinkSetup(
  provider: ReturnType<typeof createAppProvider>,
  projectName: string,
  workspace: AuthWorkspace,
  signal: AbortSignal,
): Promise<ProjectCandidate> {
  const created = await provider
    .createProject({ name: projectName, signal })
    .catch((error) => {
      throw projectCreateFailedError(error, projectName, workspace, {
        nextSteps: [
          "prisma-cli project list",
          "prisma-cli project link <id-or-name>",
          `prisma-cli project create ${formatCommandArgument(projectName)}`,
        ],
        permissionFix:
          "Grant the token permission to create Projects in this workspace, or link an existing Project.",
        fallbackFix:
          "Retry the command, or choose an existing Project with prisma-cli project link <id-or-name>.",
      });
    });

  return {
    id: created.id,
    name: created.name,
    workspace,
  };
}

async function projectLinkTargetRequiredError(
  context: CommandContext,
  projects: ProjectCandidate[],
): Promise<CliError> {
  const suggestedName = await inferTargetName(
    context.runtime.cwd,
    context.runtime.signal,
  );
  const createCommand = `prisma-cli project create ${formatCommandArgument(suggestedName.name)}`;
  const recoveryCommands = [
    "prisma-cli project link <id-or-name>",
    createCommand,
  ];

  return new CliError({
    code: "PROJECT_LINK_TARGET_REQUIRED",
    domain: "project",
    summary: "Choose a Project to link this directory",
    why: "This directory is not linked to a Prisma Project. Existing Projects are candidates until the user chooses one, and package or directory names are suggestions only.",
    fix: "Run prisma-cli project link in a TTY to choose from the setup list, pass a Project id or name, or create a new Project.",
    meta: {
      suggestedProjectName: suggestedName.name,
      suggestedProjectNameSource: suggestedName.source,
      candidates: sortProjects(projects).map(toProjectSummary),
      recoveryCommands,
    },
    exitCode: 2,
    nextSteps: ["prisma-cli project list", ...recoveryCommands],
    nextActions: buildProjectSetupNextActions({
      suggestedProjectName: suggestedName.name,
      createCommand,
      reason:
        "Project link needs the user to choose an existing Project or create a new one. Existing Projects, package names, and directory names are candidates only, not selections.",
    }),
  });
}

export interface ProjectRenameOptions {
  project?: string;
}

export interface ProjectRemoveOptions {
  confirm?: string;
}

export interface ProjectTransferOptions {
  toWorkspace?: string;
  recipientToken?: string;
  confirm?: string;
}

export async function runProjectRename(
  context: CommandContext,
  newName: string,
  options: ProjectRenameOptions,
): Promise<CommandSuccess<ProjectRenameResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  const name = newName.trim();
  if (!isValidProjectSetupName(name)) {
    throw projectSetupNameRequiredError("project rename");
  }

  const { provider, target } = await requireProjectCommandContext(
    context,
    workspace,
    options.project,
    "project rename",
  );

  const previousName = target.project.name;
  const renamed = await provider.renameProject({
    projectId: target.project.id,
    name,
    signal: context.runtime.signal,
  });

  return {
    command: "project.rename",
    result: {
      workspace,
      project: renamed,
      previousName,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runProjectRemove(
  context: CommandContext,
  projectRef: string,
  options: ProjectRemoveOptions,
): Promise<CommandSuccess<ProjectRemoveResult>> {
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(
    context.runtime.cwd,
  );
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  const { provider, projects } = await requireProjectMutationContext(
    context,
    workspace,
  );
  const project = toProjectSummary(
    resolveProjectForSetup(projectRef.trim(), projects, workspace),
  );

  requireProjectExactConfirmation({
    id: project.id,
    confirm: options.confirm,
    summary: "Confirm project removal",
    why: "Removing a project is permanent, deletes its databases, and stops its apps, so it requires the exact project id.",
    nextStep: formatCommand([
      "project",
      "remove",
      project.id,
      "--confirm",
      project.id,
    ]),
  });

  await provider.removeProject({
    projectId: project.id,
    signal: context.runtime.signal,
  });

  const warnings: string[] = [];
  const cleared = await cleanupLocalPinForProject(context, project.id, {
    onError: (message) => warnings.push(message),
  });

  return {
    command: "project.remove",
    result: {
      workspace,
      project,
      localPin: { cleared },
    },
    warnings,
    nextSteps: [],
  };
}

export async function runProjectTransfer(
  context: CommandContext,
  projectRef: string,
  options: ProjectTransferOptions,
): Promise<CommandSuccess<ProjectTransferResult>> {
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(
    context.runtime.cwd,
  );
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (options.toWorkspace && options.recipientToken) {
    throw usageError(
      "Choose one transfer recipient source",
      "--to-workspace and --recipient-token are mutually exclusive.",
      "Pass either --to-workspace <id-or-name> or --recipient-token <token>.",
      [
        formatCommand([
          "project",
          "transfer",
          "<project>",
          "--to-workspace",
          "<id-or-name>",
          "--confirm",
          "<project-id>",
        ]),
      ],
      "project",
    );
  }
  if (!options.toWorkspace?.trim() && !options.recipientToken?.trim()) {
    throw transferRecipientRequiredError(formatCommand);
  }

  const { provider, projects } = await requireProjectMutationContext(
    context,
    workspace,
  );
  const project = toProjectSummary(
    resolveProjectForSetup(projectRef.trim(), projects, workspace),
  );

  requireProjectExactConfirmation({
    id: project.id,
    confirm: options.confirm,
    summary: "Confirm project transfer",
    why: "Transferring moves the project to another workspace and this workspace loses access, so it requires the exact project id.",
    nextStep: `${formatCommand(["project", "transfer", project.id])} ${
      options.toWorkspace
        ? `--to-workspace ${formatCommandArgument(options.toWorkspace)}`
        : "--recipient-token <token>"
    } --confirm ${project.id}`,
  });

  const recipient = await resolveTransferRecipient(context, options);
  await provider.transferProject({
    projectId: project.id,
    recipientAccessToken: recipient.accessToken,
    signal: context.runtime.signal,
  });

  const warnings: string[] = [];
  const pinAction = await rewriteOrClearLocalPinForProject(
    context,
    project.id,
    recipient.workspaceId,
    { onError: (message) => warnings.push(message) },
  );

  return {
    command: "project.transfer",
    result: {
      workspace,
      project,
      recipient: {
        workspaceId: recipient.workspaceId,
        workspaceName: recipient.workspaceName,
        source: recipient.source,
      },
      localPin: { action: pinAction },
    },
    warnings,
    nextSteps: options.toWorkspace
      ? [
          `${formatCommand(["auth", "workspace", "use"])} ${formatCommandArgument(options.toWorkspace)}`,
        ]
      : [],
  };
}

interface ResolvedTransferRecipient {
  accessToken: string;
  workspaceId: string | null;
  workspaceName: string | null;
  source: "workspace-session" | "recipient-token";
}

async function resolveTransferRecipient(
  context: CommandContext,
  options: ProjectTransferOptions,
): Promise<ResolvedTransferRecipient> {
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(
    context.runtime.cwd,
  );
  const recipientToken = options.recipientToken?.trim();
  if (recipientToken) {
    return {
      accessToken: recipientToken,
      workspaceId: isRealMode(context)
        ? null
        : // Fixture convention: the recipient token is the target workspace id.
          recipientToken,
      workspaceName: null,
      source: "recipient-token",
    };
  }

  const workspaceRef = options.toWorkspace?.trim();
  if (!workspaceRef) {
    throw transferRecipientRequiredError(formatCommand);
  }

  if (!isRealMode(context)) {
    const workspaces = context.api.listWorkspaces();
    const matches = workspaces.filter(
      (candidate) =>
        candidate.id === workspaceRef ||
        candidate.name.toLowerCase() === workspaceRef.toLowerCase(),
    );
    if (matches.length === 0) {
      throw workspaceNotAuthenticatedError(workspaceRef);
    }
    if (matches.length > 1) {
      throw workspaceAmbiguousError(
        workspaceRef,
        matches.map((match) => ({
          id: match.id,
          name: match.name,
          credentialWorkspaceId: match.id,
        })),
      );
    }
    return {
      // Fixture transfers authorize by workspace id instead of a real token.
      accessToken: matches[0]!.id,
      workspaceId: matches[0]!.id,
      workspaceName: matches[0]!.name,
      source: "workspace-session",
    };
  }

  if (context.runtime.env[SERVICE_TOKEN_ENV_VAR] !== undefined) {
    throw transferRecipientUnavailableError(formatCommand);
  }

  try {
    const session = await resolveRecipientWorkspaceSession(
      workspaceRef,
      context.runtime.env,
      context.runtime.signal,
    );
    return {
      accessToken: session.accessToken,
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      source: "workspace-session",
    };
  } catch (error) {
    if (error instanceof WorkspaceSelectionError) {
      if (error.reason === "ambiguous") {
        throw workspaceAmbiguousError(
          error.workspaceRef ?? workspaceRef,
          error.matches.map((match) => ({
            id: match.id,
            name: match.name,
            credentialWorkspaceId: match.credentialWorkspaceId,
          })),
        );
      }
      throw workspaceNotAuthenticatedError(error.workspaceRef ?? workspaceRef);
    }
    if (error instanceof RecipientSessionInvalidError) {
      throw workspaceNotAuthenticatedError(error.workspaceRef);
    }
    throw error;
  }
}

interface ProjectMutationContext {
  provider: ProjectProvider;
  projects: ProjectCandidate[];
}

async function requireProjectMutationContext(
  context: CommandContext,
  workspace: AuthWorkspace,
): Promise<ProjectMutationContext> {
  if (isRealMode(context)) {
    const client = await requireProjectClient(context);
    return {
      provider: createManagementProjectProvider(client),
      projects: await listRealWorkspaceProjects(
        client,
        workspace,
        context.runtime.signal,
      ),
    };
  }

  return {
    provider: createFixtureProjectProvider(context),
    projects: listFixtureWorkspaceProjects(context, workspace),
  };
}

async function requireProjectCommandContext(
  context: CommandContext,
  workspace: AuthWorkspace,
  explicitProject: string | undefined,
  commandName: string,
): Promise<{ provider: ProjectProvider; target: ResolvedProjectTarget }> {
  const realMode = isRealMode(context);
  const client = realMode ? await requireProjectClient(context) : null;
  const listProjects = async () =>
    client
      ? listRealWorkspaceProjects(client, workspace, context.runtime.signal)
      : listFixtureWorkspaceProjects(context, workspace);

  const targetResult = await resolveProjectTarget({
    context,
    workspace,
    explicitProject,
    listProjects,
    commandName,
  });
  if (targetResult.isErr()) {
    throw projectResolutionErrorToCliError(targetResult.error);
  }

  const provider = client
    ? createManagementProjectProvider(client)
    : createFixtureProjectProvider(context);

  return { provider, target: targetResult.value };
}

async function requireProjectClient(
  context: CommandContext,
): Promise<ManagementApiClient> {
  const client = await requireComputeAuth(
    context.runtime.env,
    context.runtime.signal,
  );
  if (!client) {
    throw authRequiredError();
  }
  return client;
}

function createFixtureProjectProvider(
  context: CommandContext,
): ProjectProvider {
  const fixtureFormatCommand = resolvePrismaCliPackageCommandFormatterSync(
    context.runtime.cwd,
  );
  return {
    async renameProject(options) {
      const renamed = context.api.renameProject(
        options.projectId,
        options.name,
      );
      if (!renamed) {
        throw projectRenameFailedError(options.name, undefined);
      }
      return {
        id: renamed.id,
        name: renamed.name,
        ...(renamed.url ? { url: renamed.url } : {}),
      };
    },

    async removeProject(options) {
      const removed = context.api.removeProject(options.projectId);
      if (removed.outcome === "blocked") {
        throw projectRemoveBlockedError(options.projectId, undefined);
      }
      if (removed.outcome === "not-found") {
        throw new CliError({
          code: "PROJECT_NOT_FOUND",
          domain: "project",
          summary: "Project not found",
          why: `No project matched "${options.projectId}".`,
          fix: `Pass a project id or name from ${fixtureFormatCommand(["project", "list"])}.`,
          exitCode: 1,
          nextSteps: [fixtureFormatCommand(["project", "list"])],
        });
      }
    },

    async transferProject(options) {
      const transferred = context.api.transferProject(
        options.projectId,
        options.recipientAccessToken,
      );
      if (transferred.outcome !== "transferred") {
        throw projectTransferRejectedError(options.projectId, undefined);
      }
    },
  };
}

function requireProjectExactConfirmation(options: {
  id: string;
  confirm: string | undefined;
  summary: string;
  why: string;
  nextStep: string;
}): void {
  if (options.confirm === options.id) {
    return;
  }

  throw new CliError({
    code: "CONFIRMATION_REQUIRED",
    domain: "project",
    summary: options.summary,
    why: options.why,
    fix: `Rerun with --confirm ${options.id}.`,
    exitCode: 2,
    nextSteps: [options.nextStep],
    meta: {
      expectedConfirm: options.id,
      receivedConfirm: options.confirm ?? null,
    },
  });
}

function transferRecipientRequiredError(
  formatCommand: PrismaCliPackageCommandFormatter,
): CliError {
  return new CliError({
    code: "TRANSFER_RECIPIENT_REQUIRED",
    domain: "project",
    summary: "Transfer recipient required",
    why: "Project transfer needs the receiving workspace.",
    fix: "Pass --to-workspace <id-or-name> for a locally authenticated workspace, or --recipient-token <token> for a cross-account transfer.",
    exitCode: 2,
    nextSteps: [
      formatCommand(["auth", "workspace", "list"]),
      formatCommand([
        "project",
        "transfer",
        "<project>",
        "--to-workspace",
        "<id-or-name>",
        "--confirm",
        "<project-id>",
      ]),
    ],
  });
}

function transferRecipientUnavailableError(
  formatCommand: PrismaCliPackageCommandFormatter,
): CliError {
  return new CliError({
    code: "TRANSFER_RECIPIENT_UNAVAILABLE",
    domain: "project",
    summary: "Local workspace sessions are unavailable",
    why: `--to-workspace resolves locally stored OAuth sessions, but ${SERVICE_TOKEN_ENV_VAR} is set and service-token mode does not read them.`,
    fix: "Pass --recipient-token <token> with an access token for the receiving workspace, or unset the service token.",
    exitCode: 1,
    nextSteps: [
      formatCommand([
        "project",
        "transfer",
        "<project>",
        "--recipient-token",
        "<token>",
        "--confirm",
        "<project-id>",
      ]),
    ],
  });
}

async function cleanupLocalPinForProject(
  context: CommandContext,
  projectId: string,
  hooks: { onError: (message: string) => void },
): Promise<boolean> {
  const pinResult = await readLocalResolutionPin(
    context.runtime.cwd,
    context.runtime.signal,
  );
  if (pinResult.isErr()) {
    return false;
  }
  const pin = pinResult.value;
  if (pin.kind !== "present" || pin.pin.projectId !== projectId) {
    return false;
  }

  try {
    await unlink(
      path.join(context.runtime.cwd, LOCAL_RESOLUTION_PIN_RELATIVE_PATH),
    );
    return true;
  } catch {
    hooks.onError(
      `The local pin ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} points at the removed project but could not be deleted.`,
    );
    return false;
  }
}

async function rewriteOrClearLocalPinForProject(
  context: CommandContext,
  projectId: string,
  recipientWorkspaceId: string | null,
  hooks: { onError: (message: string) => void },
): Promise<"rewritten" | "cleared" | "none"> {
  const pinResult = await readLocalResolutionPin(
    context.runtime.cwd,
    context.runtime.signal,
  );
  if (pinResult.isErr()) {
    return "none";
  }
  const pin = pinResult.value;
  if (pin.kind !== "present" || pin.pin.projectId !== projectId) {
    return "none";
  }

  if (recipientWorkspaceId) {
    const writeResult = await writeLocalResolutionPin(
      context.runtime.cwd,
      { workspaceId: recipientWorkspaceId, projectId },
      context.runtime.signal,
    );
    if (writeResult.isOk()) {
      return "rewritten";
    }
    hooks.onError(
      `The local pin ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} points at the transferred project but could not be rewritten.`,
    );
    return "none";
  }

  try {
    await unlink(
      path.join(context.runtime.cwd, LOCAL_RESOLUTION_PIN_RELATIVE_PATH),
    );
    return "cleared";
  } catch {
    hooks.onError(
      `The local pin ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} points at the transferred project but could not be cleared.`,
    );
    return "none";
  }
}

export async function runGitConnect(
  context: CommandContext,
  gitUrl: string | undefined,
  options: GitConnectOptions = {},
): Promise<CommandSuccess<ProjectRepositoryConnectionResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (isRealMode(context)) {
    const client = await requireComputeAuth(
      context.runtime.env,
      context.runtime.signal,
    );
    if (!client) {
      throw authRequiredError();
    }

    const target = await resolveRequiredProjectInRealMode(
      context,
      workspace,
      options.project,
      "git connect",
    );
    const repository = await resolveRepositoryForConnect(context, gitUrl);
    const api = client as unknown as SourceRepositoryApiClient;
    const existing = await readFirstSourceRepository(
      api,
      target.project.id,
      context.runtime.signal,
    );

    if (existing) {
      const existingConnection = toRepositoryConnection(existing);
      if (
        repositoryFullNamesMatch(
          existingConnection.repository.fullName,
          repository.fullName,
        )
      ) {
        return {
          command: "git.connect",
          result: {
            ...target,
            repositoryConnection: existingConnection,
          },
          warnings: [],
          nextSteps: [],
        };
      }

      throw repoAlreadyConnectedError(existingConnection.repository.fullName);
    }

    const resolvedRepository = await resolveInstalledRepository(
      context,
      api,
      workspace.id,
      repository,
    );
    const { data, error, response } = await api.POST(
      "/v1/source-repositories",
      {
        body: {
          projectId: target.project.id,
          provider: "github",
          providerRepositoryId: resolvedRepository.repository.id,
          installationId: resolvedRepository.installation.id,
        },
        signal: context.runtime.signal,
      },
    );

    if (error || !data) {
      throw repoConnectionApiError(
        "Failed to connect GitHub repository",
        response,
        error,
      );
    }

    return {
      command: "git.connect",
      result: {
        ...target,
        repositoryConnection: toRepositoryConnection(data.data),
      },
      warnings: [],
      nextSteps: [],
    };
  }

  const target = await resolveRequiredProjectInFixtureMode(
    context,
    workspace,
    options.project,
    "git connect",
  );
  const repository = await resolveRepositoryForConnect(context, gitUrl);
  const existingConnection = await context.stateStore.readRepositoryConnection(
    target.project.id,
  );

  if (existingConnection) {
    if (
      repositoryFullNamesMatch(
        existingConnection.repository.fullName,
        repository.fullName,
      )
    ) {
      return {
        command: "git.connect",
        result: {
          ...target,
          repositoryConnection: existingConnection,
        },
        warnings: [],
        nextSteps: [],
      };
    }

    throw repoAlreadyConnectedError(existingConnection.repository.fullName);
  }

  const connection = createPendingRepositoryConnection(repository);
  await context.stateStore.setRepositoryConnection(
    target.project.id,
    connection,
  );

  return {
    command: "git.connect",
    result: {
      ...target,
      repositoryConnection: connection,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runGitDisconnect(
  context: CommandContext,
  options: GitDisconnectOptions = {},
): Promise<CommandSuccess<ProjectRepositoryConnectionResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (isRealMode(context)) {
    const client = await requireComputeAuth(
      context.runtime.env,
      context.runtime.signal,
    );
    if (!client) {
      throw authRequiredError();
    }

    const target = await resolveRequiredProjectInRealMode(
      context,
      workspace,
      options.project,
      "git disconnect",
    );
    const api = client as unknown as SourceRepositoryApiClient;
    const existing = await readFirstSourceRepository(
      api,
      target.project.id,
      context.runtime.signal,
    );

    if (!existing) {
      throw repoNotConnectedError();
    }

    const { error, response } = await api.DELETE(
      "/v1/source-repositories/{id}",
      {
        params: {
          path: {
            id: existing.id,
          },
        },
        signal: context.runtime.signal,
      },
    );

    if (error) {
      throw repoConnectionApiError(
        "Failed to disconnect GitHub repository",
        response,
        error,
      );
    }

    return {
      command: "git.disconnect",
      result: {
        ...target,
        repositoryConnection: toRepositoryConnection(existing),
      },
      warnings: [],
      nextSteps: [],
    };
  }

  const target = await resolveRequiredProjectInFixtureMode(
    context,
    workspace,
    options.project,
    "git disconnect",
  );
  const existingConnection = await context.stateStore.readRepositoryConnection(
    target.project.id,
  );

  if (!existingConnection) {
    throw repoNotConnectedError();
  }

  await context.stateStore.clearRepositoryConnection(target.project.id);

  return {
    command: "git.disconnect",
    result: {
      ...target,
      repositoryConnection: existingConnection,
    },
    warnings: [],
    nextSteps: [],
  };
}

async function resolveProjectShowInRealMode(
  context: CommandContext,
  workspace: AuthWorkspace,
  explicitProject: string | undefined,
): Promise<ProjectShowResult> {
  const client = await requireComputeAuth(
    context.runtime.env,
    context.runtime.signal,
  );
  if (!client) {
    throw authRequiredError();
  }

  const result = await inspectProjectBinding({
    context,
    workspace,
    explicitProject,
    listProjects: () =>
      listRealWorkspaceProjects(client, workspace, context.runtime.signal),
    commandName: "project show",
  });
  if (result.isErr()) {
    throw projectResolutionErrorToCliError(result.error);
  }
  return result.value;
}

async function resolveRequiredProjectInRealMode(
  context: CommandContext,
  workspace: AuthWorkspace,
  explicitProject: string | undefined,
  commandName: string,
): Promise<ResolvedProjectTarget> {
  const client = await requireComputeAuth(
    context.runtime.env,
    context.runtime.signal,
  );
  if (!client) {
    throw authRequiredError();
  }

  const result = await resolveProjectTarget({
    context,
    workspace,
    explicitProject,
    listProjects: () =>
      listRealWorkspaceProjects(client, workspace, context.runtime.signal),
    commandName,
  });
  if (result.isErr()) {
    throw projectResolutionErrorToCliError(result.error);
  }
  return result.value;
}

async function resolveProjectShowInFixtureMode(
  context: CommandContext,
  workspace: AuthWorkspace,
  explicitProject: string | undefined,
): Promise<ProjectShowResult> {
  const result = await inspectProjectBinding({
    context,
    workspace,
    explicitProject,
    listProjects: async () => listFixtureWorkspaceProjects(context, workspace),
    commandName: "project show",
  });
  if (result.isErr()) {
    throw projectResolutionErrorToCliError(result.error);
  }
  return result.value;
}

async function resolveRequiredProjectInFixtureMode(
  context: CommandContext,
  workspace: AuthWorkspace,
  explicitProject: string | undefined,
  commandName: string,
): Promise<ResolvedProjectTarget> {
  const result = await resolveProjectTarget({
    context,
    workspace,
    explicitProject,
    listProjects: async () => listFixtureWorkspaceProjects(context, workspace),
    commandName,
  });
  if (result.isErr()) {
    throw projectResolutionErrorToCliError(result.error);
  }
  return result.value;
}

export async function listRealWorkspaceProjects(
  client: ManagementApiClient,
  workspace: AuthWorkspace,
  signal?: AbortSignal,
): Promise<ProjectCandidate[]> {
  const { data } = await client.GET("/v1/projects", { signal });
  return sortProjects(
    (data?.data ?? [])
      .filter((project) => project.workspace.id === workspace.id)
      .map((project) => ({
        id: project.id,
        name: project.name,
        ...("url" in project && typeof project.url === "string"
          ? { url: project.url }
          : {}),
        slug:
          "slug" in project && typeof project.slug === "string"
            ? project.slug
            : null,
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
      ...(project.url ? { url: project.url } : {}),
      slug: project.slug,
      workspace,
    })),
  );
}

interface SourceRepositoryResponse {
  id: string;
  type?: "source-repository";
  url?: string;
  repoId: number;
  provider: "github";
  repoFullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  status: "active" | "archived";
  installationId: string;
  createdAt: string;
  updatedAt: string;
}

interface ScmInstallationResponse {
  id: string;
  type: "scm-installation";
  url: string;
  provider: "github";
  installationId: number;
  accountId: number;
  accountLogin: string;
  accountType: "user" | "organization";
  suspended: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ScmRepositoryResponse {
  id: number;
  type: "scm-repository";
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
}

interface InstalledRepositoryMatch {
  installation: ScmInstallationResponse;
  repository: ScmRepositoryResponse;
}

interface InstallationRepositoryLookup {
  match: InstalledRepositoryMatch | null;
  inspectableInstallationCount: number;
}

interface SourceRepositoryApiError {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

interface SourceRepositoryApiResult<T> {
  data?: T;
  error?: SourceRepositoryApiError;
  response?: Response;
}

interface SourceRepositoryApiClient {
  POST(
    path: "/v1/source-repositories",
    options: {
      body: {
        projectId: string;
        provider: "github";
        providerRepositoryId: number;
        installationId?: string;
      };
      signal?: AbortSignal;
    },
  ): Promise<SourceRepositoryApiResult<{ data: SourceRepositoryResponse }>>;
  POST(
    path: "/v1/scm-installations/install-intents",
    options: {
      body: {
        provider: "github";
        workspaceId: string;
      };
      signal?: AbortSignal;
    },
  ): Promise<
    SourceRepositoryApiResult<{
      data: {
        type: "install-intent";
        provider: "github";
        workspaceId: string;
        installUrl: string;
      };
    }>
  >;
  GET(
    path: "/v1/source-repositories",
    options: {
      params: {
        query: {
          projectId: string;
          cursor?: string;
          limit?: number;
        };
      };
      signal?: AbortSignal;
    },
  ): Promise<
    SourceRepositoryApiResult<{
      data: SourceRepositoryResponse[];
      pagination: {
        nextCursor: string | null;
        hasMore: boolean;
      };
    }>
  >;
  GET(
    path: "/v1/scm-installations",
    options: {
      params: {
        query: {
          workspaceId: string;
          cursor?: string;
          limit?: number;
        };
      };
      signal?: AbortSignal;
    },
  ): Promise<
    SourceRepositoryApiResult<{
      data: ScmInstallationResponse[];
      pagination: {
        nextCursor: string | null;
        hasMore: boolean;
      };
    }>
  >;
  GET(
    path: "/v1/scm-installations/{installationId}/repositories",
    options: {
      params: {
        path: {
          installationId: string;
        };
        query: {
          cursor?: string;
          limit?: number;
        };
      };
      signal?: AbortSignal;
    },
  ): Promise<
    SourceRepositoryApiResult<{
      data: ScmRepositoryResponse[];
      pagination: {
        nextCursor: string | null;
        hasMore: boolean;
      };
    }>
  >;
  DELETE(
    path: "/v1/source-repositories/{id}",
    options: {
      params: {
        path: {
          id: string;
        };
      };
      signal?: AbortSignal;
    },
  ): Promise<SourceRepositoryApiResult<unknown>>;
}

async function resolveRepositoryForConnect(
  context: CommandContext,
  gitUrl: string | undefined,
): Promise<GitHubRepositoryReference> {
  const remoteUrl =
    gitUrl ??
    (await readGitOriginRemote(context.runtime.cwd, context.runtime.signal));

  if (!remoteUrl) {
    throw usageError(
      "Repository connection requires a GitHub repository URL",
      "No git-url was provided and the local repo does not have an origin remote.",
      "Pass a GitHub repository URL, or add a GitHub origin remote and rerun prisma-cli git connect.",
      ["prisma-cli git connect git@github.com:prisma/prisma-cli.git"],
      "project",
    );
  }

  const repository = parseGitHubRepositoryUrl(remoteUrl);
  if (!repository) {
    throw unsupportedRepositoryProviderError();
  }

  return repository;
}

async function resolveInstalledRepository(
  context: CommandContext,
  api: SourceRepositoryApiClient,
  workspaceId: string,
  repository: GitHubRepositoryReference,
): Promise<InstalledRepositoryMatch> {
  const installations = await listScmInstallations(
    api,
    workspaceId,
    context.runtime.signal,
  );
  const lookup = await findRepositoryInInstallations(
    api,
    installations,
    repository,
    context.runtime.signal,
  );
  if (lookup.match) {
    return lookup.match;
  }

  const installUrl = await createGitHubInstallIntent(
    api,
    workspaceId,
    context.runtime.signal,
  );
  const canWait = canPrompt(context);
  const opened = await openInstallUrlIfInteractive(context, installUrl);

  if (!canWait) {
    if (lookup.inspectableInstallationCount > 0) {
      throw repoNotAccessibleError(repository, installUrl, opened);
    }

    throw repoInstallationRequiredError(repository, installUrl, opened);
  }

  writeInstallWaitStatus(context, opened, installUrl);

  const result = await waitForInstalledRepository(
    context,
    api,
    workspaceId,
    repository,
  );
  if (result.match) {
    return result.match;
  }

  if (result.inspectableInstallationCount > 0) {
    throw repoNotAccessibleError(repository, installUrl, opened);
  }

  throw repoInstallationRequiredError(repository, installUrl, opened);
}

async function findRepositoryInInstallations(
  api: SourceRepositoryApiClient,
  installations: ScmInstallationResponse[],
  repository: GitHubRepositoryReference,
  signal: AbortSignal,
): Promise<InstallationRepositoryLookup> {
  let inspectableInstallationCount = 0;

  for (const installation of installations) {
    if (installation.provider !== "github" || installation.suspended) {
      continue;
    }

    // biome-ignore lint/performance/noAwaitInLoops: Installation access is inspected in order so we can stop at the first matching repository.
    const matchedRepository = await findRepositoryInInstallationIfAvailable(
      api,
      installation.id,
      repository,
      signal,
    );
    if (matchedRepository === "unavailable") {
      continue;
    }

    inspectableInstallationCount += 1;
    if (matchedRepository) {
      return {
        match: {
          installation,
          repository: matchedRepository,
        },
        inspectableInstallationCount,
      };
    }
  }

  return {
    match: null,
    inspectableInstallationCount,
  };
}

async function waitForInstalledRepository(
  context: CommandContext,
  api: SourceRepositoryApiClient,
  workspaceId: string,
  repository: GitHubRepositoryReference,
): Promise<{
  match: InstalledRepositoryMatch | null;
  inspectableInstallationCount: number;
}> {
  const timeoutMs = readPositiveIntegerEnv(
    context.runtime.env.PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS,
    GITHUB_INSTALL_POLL_TIMEOUT_MS,
  );
  const intervalMs = readPositiveIntegerEnv(
    context.runtime.env.PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS,
    GITHUB_INSTALL_POLL_INTERVAL_MS,
  );
  const deadline = Date.now() + timeoutMs;
  let inspectableInstallationCount = 0;

  while (Date.now() <= deadline) {
    context.runtime.signal.throwIfAborted();
    // biome-ignore lint/performance/noAwaitInLoops: Polling intentionally waits for each remote inspection before sleeping or retrying.
    const installations = await listScmInstallations(
      api,
      workspaceId,
      context.runtime.signal,
    );

    const lookup = await findRepositoryInInstallations(
      api,
      installations,
      repository,
      context.runtime.signal,
    );
    inspectableInstallationCount = lookup.inspectableInstallationCount;
    if (lookup.match) {
      return { match: lookup.match, inspectableInstallationCount };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await sleep(Math.min(intervalMs, remainingMs), context.runtime.signal);
  }

  return { match: null, inspectableInstallationCount };
}

function readPositiveIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function writeInstallWaitStatus(
  context: CommandContext,
  opened: boolean,
  installUrl: string,
): void {
  if (context.flags.quiet) {
    return;
  }

  const lines = [
    renderSummaryLine(
      context.ui,
      "info",
      opened
        ? "Waiting for GitHub App installation or repository access approval..."
        : "Waiting for GitHub App installation or repository access approval. Open the install URL in your browser.",
    ),
  ];

  if (!opened) {
    lines.push(installUrl);
  }

  context.output.stderr.write(`${lines.join("\n")}\n`);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function listScmInstallations(
  api: SourceRepositoryApiClient,
  workspaceId: string,
  signal: AbortSignal,
): Promise<ScmInstallationResponse[]> {
  const installations: ScmInstallationResponse[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    // biome-ignore lint/performance/noAwaitInLoops: Cursor pagination is sequential by API contract.
    const { data, error, response } = await api.GET("/v1/scm-installations", {
      params: {
        query: {
          workspaceId,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        },
      },
      signal,
    });

    if (error || !data) {
      throw repoConnectionApiError(
        "Failed to inspect GitHub App installations",
        response,
        error,
      );
    }

    installations.push(...data.data);
    cursor = readNextPaginationCursor(
      data.pagination,
      seenCursors,
      "Failed to inspect GitHub App installations",
      response,
    );
  } while (cursor);

  return installations;
}

async function findRepositoryInInstallation(
  api: SourceRepositoryApiClient,
  installationId: string,
  repository: GitHubRepositoryReference,
  signal: AbortSignal,
): Promise<ScmRepositoryResponse | null> {
  const expectedFullName = repository.fullName.toLowerCase();
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    // biome-ignore lint/performance/noAwaitInLoops: Cursor pagination is sequential by API contract.
    const { data, error, response } = await api.GET(
      "/v1/scm-installations/{installationId}/repositories",
      {
        params: {
          path: {
            installationId,
          },
          query: {
            limit: 100,
            ...(cursor ? { cursor } : {}),
          },
        },
        signal,
      },
    );

    if (error || !data) {
      throw repoConnectionApiError(
        "Failed to inspect GitHub repositories",
        response,
        error,
      );
    }

    const matchedRepository = data.data.find(
      (candidate) => candidate.fullName.toLowerCase() === expectedFullName,
    );
    if (matchedRepository) {
      return matchedRepository;
    }

    cursor = readNextPaginationCursor(
      data.pagination,
      seenCursors,
      "Failed to inspect GitHub repositories",
      response,
    );
  } while (cursor);

  return null;
}

function readNextPaginationCursor(
  pagination: { hasMore: boolean; nextCursor: string | null },
  seenCursors: Set<string>,
  summary: string,
  response: Response | undefined,
): string | undefined {
  const nextCursor =
    pagination.hasMore && pagination.nextCursor
      ? pagination.nextCursor
      : undefined;
  if (!nextCursor) {
    return undefined;
  }

  if (seenCursors.has(nextCursor)) {
    throw repoConnectionApiError(summary, response, {
      error: {
        message: "Pagination cursor did not advance.",
      },
    });
  }

  seenCursors.add(nextCursor);
  return nextCursor;
}

async function findRepositoryInInstallationIfAvailable(
  api: SourceRepositoryApiClient,
  installationId: string,
  repository: GitHubRepositoryReference,
  signal: AbortSignal,
): Promise<ScmRepositoryResponse | null | "unavailable"> {
  try {
    return await findRepositoryInInstallation(
      api,
      installationId,
      repository,
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw error;
    if (isUnavailableScmInstallationError(error)) {
      return "unavailable";
    }

    throw error;
  }
}

function isUnavailableScmInstallationError(error: unknown): boolean {
  if (!(error instanceof CliError) || error.code !== "REPO_CONNECTION_FAILED") {
    return false;
  }

  return error.meta.status === 404 || error.meta.status === 422;
}

async function createGitHubInstallIntent(
  api: SourceRepositoryApiClient,
  workspaceId: string,
  signal: AbortSignal,
): Promise<string> {
  const { data, error, response } = await api.POST(
    "/v1/scm-installations/install-intents",
    {
      body: {
        provider: "github",
        workspaceId,
      },
      signal,
    },
  );

  if (error || !data) {
    throw repoConnectionApiError(
      "Failed to create GitHub App installation link",
      response,
      error,
    );
  }

  return data.data.installUrl;
}

async function openInstallUrlIfInteractive(
  context: CommandContext,
  installUrl: string,
): Promise<boolean> {
  if (!canPrompt(context)) {
    return false;
  }

  try {
    context.runtime.signal.throwIfAborted();
    // Browser launch cannot consume AbortSignal; check immediately before and after the boundary.
    await open(installUrl);
    context.runtime.signal.throwIfAborted();
    return true;
  } catch (error) {
    if (context.runtime.signal.aborted) throw error;
    return false;
  }
}

async function readFirstSourceRepository(
  api: SourceRepositoryApiClient,
  projectId: string,
  signal: AbortSignal,
): Promise<SourceRepositoryResponse | null> {
  const { data, error, response } = await api.GET("/v1/source-repositories", {
    params: {
      query: {
        projectId,
        limit: 1,
      },
    },
    signal,
  });

  if (error || !data) {
    throw repoConnectionApiError(
      "Failed to inspect GitHub repository connection",
      response,
      error,
    );
  }

  return data.data[0] ?? null;
}

function createPendingRepositoryConnection(
  repository: GitHubRepositoryReference,
): GitRepositoryConnection {
  return {
    id: null,
    provider: "github",
    repoId: null,
    repository,
    defaultBranch: null,
    isPrivate: null,
    status: "pending",
    installation: {
      id: null,
      status: "pending",
    },
    automation: {
      branches: false,
      pullRequests: false,
      comments: false,
    },
    connectedAt: new Date().toISOString(),
    updatedAt: null,
  };
}

function toRepositoryConnection(
  record: SourceRepositoryResponse,
): GitRepositoryConnection {
  const [owner = "", name = ""] = record.repoFullName.split("/");

  return {
    id: record.id,
    provider: "github",
    repoId: record.repoId,
    repository: {
      owner,
      name,
      fullName: record.repoFullName,
      url: `https://github.com/${record.repoFullName}`,
    },
    defaultBranch: record.defaultBranch,
    isPrivate: record.isPrivate,
    status: record.status,
    installation: {
      id: record.installationId,
      status: "connected",
    },
    automation: {
      branches: record.status === "active",
      pullRequests: false,
      comments: false,
    },
    connectedAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function unsupportedRepositoryProviderError(): CliError {
  return new CliError({
    code: "REPO_PROVIDER_UNSUPPORTED",
    domain: "project",
    summary: "Repository provider is not supported",
    why: "Repository connection supports GitHub repository URLs only.",
    fix: "Pass a GitHub repository URL such as git@github.com:prisma/prisma-cli.git.",
    exitCode: 2,
    nextSteps: ["prisma-cli git connect git@github.com:owner/repo.git"],
  });
}

function repoNotConnectedError(): CliError {
  return new CliError({
    code: "REPO_NOT_CONNECTED",
    domain: "project",
    summary: "No GitHub repository connected",
    why: "The resolved project does not have an active GitHub repository connection.",
    fix: "Run prisma-cli git connect before disconnecting.",
    exitCode: 1,
    nextSteps: ["prisma-cli git connect"],
  });
}

function repoInstallationRequiredError(
  repository: GitHubRepositoryReference,
  installUrl: string,
  opened: boolean,
): CliError {
  return new CliError({
    code: "REPO_INSTALLATION_REQUIRED",
    domain: "project",
    summary: "GitHub App installation required",
    why: `The selected workspace does not have a GitHub App installation that can be used to link ${repository.fullName}.`,
    fix: opened
      ? "Finish installing the GitHub App in the browser, then rerun prisma-cli git connect."
      : "Open the GitHub App installation URL, approve access, then rerun prisma-cli git connect.",
    meta: {
      repository: repository.fullName,
      installUrl,
      opened,
    },
    exitCode: 1,
    nextSteps: [installUrl, `prisma-cli git connect ${repository.url}`],
  });
}

function repoNotAccessibleError(
  repository: GitHubRepositoryReference,
  installUrl: string,
  opened: boolean,
): CliError {
  return new CliError({
    code: "REPO_NOT_ACCESSIBLE",
    domain: "project",
    summary: "GitHub repository is not accessible",
    why: `The GitHub App installations connected to this workspace do not expose ${repository.fullName}.`,
    fix: "Open the GitHub App installation URL, grant access to this repository, then rerun prisma-cli git connect.",
    meta: {
      repository: repository.fullName,
      installUrl,
      opened,
    },
    exitCode: 1,
    nextSteps: [installUrl, `prisma-cli git connect ${repository.url}`],
  });
}

function repoAlreadyConnectedError(repositoryFullName: string): CliError {
  return new CliError({
    code: "REPO_ALREADY_CONNECTED",
    domain: "project",
    summary: "Project already has a GitHub repository connected",
    why: `The resolved project is already connected to ${repositoryFullName}.`,
    fix: "Disconnect the existing repository before connecting a different one.",
    meta: {
      repository: repositoryFullName,
    },
    exitCode: 1,
    nextSteps: ["prisma-cli git disconnect"],
  });
}

function repositoryFullNamesMatch(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function repoConnectionApiError(
  summary: string,
  response: Response | undefined,
  error: SourceRepositoryApiError | undefined,
): CliError {
  const status = response?.status ?? 0;
  const apiCode = error?.error?.code;
  const apiMessage = error?.error?.message;
  const apiHint = error?.error?.hint;

  if (status === 401 || status === 403) {
    return authRequiredError(["prisma-cli auth login"]);
  }

  return new CliError({
    code: "REPO_CONNECTION_FAILED",
    domain: "project",
    summary,
    why:
      apiMessage ??
      `The Management API returned status ${status || "unknown"}.`,
    fix: apiHint ?? repoConnectionFixForStatus(status),
    meta: {
      status,
      ...(apiCode ? { apiCode } : {}),
    },
    exitCode: 1,
    nextSteps: ["prisma-cli project show"],
  });
}

function repoConnectionFixForStatus(status: number): string {
  if (status === 404) {
    return "Install the GitHub App for this workspace, then rerun prisma-cli git connect.";
  }

  if (status === 409) {
    return "This project or repository is already linked. Disconnect the old link first, then try again.";
  }

  if (status === 422) {
    return "Make sure the GitHub App installation has access to this repository.";
  }

  return "Re-run with --trace for the underlying API response details.";
}
