/**
 * Glue between the engine command context and the legacy project
 * operations. The legacy resolution and env-file operations take a
 * shell `CommandContext` but read only `runtime.cwd`, `runtime.env`
 * and `runtime.signal`, so v8 hands them exactly that.
 */
import path from "node:path";
import type { CommandContext } from "@prisma/cli-engine";
import { listRealWorkspaceProjects } from "../../controllers/project";
import {
  ensureLocalResolutionPinGitignore,
  LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
  writeLocalResolutionPin,
} from "../../lib/project/local-pin";
import {
  type ProjectCandidate,
  projectResolutionErrorToCliError,
  type ResolvedProjectTarget,
  resolveProjectTarget,
} from "../../lib/project/resolution";
import { projectDirectoryBindingErrorToCliError } from "../../lib/project/setup";
import type { CommandContext as LegacyCommandContext } from "../../shell/runtime";
import type { AuthWorkspace } from "../../types/auth";
import type { ProjectSetupResult, ProjectSummary } from "../../types/project";

export type ProjectCommandContext = CommandContext<undefined, never>;

export function legacyOperationContext(
  ctx: ProjectCommandContext,
): LegacyCommandContext {
  return {
    runtime: { cwd: ctx.cwd, env: ctx.env, signal: ctx.signal },
  } as unknown as LegacyCommandContext;
}

export function listWorkspaceProjects(
  ctx: ProjectCommandContext,
  workspace: AuthWorkspace,
): Promise<ProjectCandidate[]> {
  return listRealWorkspaceProjects(ctx.api, workspace, ctx.signal);
}

/** Explicit `--project`, else the `.prisma/local.json` pin, else the
 *  setup-required error. */
export async function resolvePinnedProject(
  ctx: ProjectCommandContext,
  workspace: AuthWorkspace,
  explicitProject: string | undefined,
  commandName: string,
): Promise<ResolvedProjectTarget> {
  const target = await resolveProjectTarget({
    context: legacyOperationContext(ctx),
    workspace,
    explicitProject,
    listProjects: () => listWorkspaceProjects(ctx, workspace),
    commandName,
  });
  if (target.isErr()) {
    throw projectResolutionErrorToCliError(target.error);
  }
  return target.value;
}

/** Writes `.prisma/local.json` for this directory and keeps it out of
 *  git, then reports what `project create` / `project link` did. */
export async function bindDirectoryToProject(
  ctx: ProjectCommandContext,
  workspace: AuthWorkspace,
  project: ProjectSummary,
  action: ProjectSetupResult["action"],
): Promise<ProjectSetupResult> {
  const written = await writeLocalResolutionPin(
    ctx.cwd,
    { workspaceId: workspace.id, projectId: project.id },
    ctx.signal,
  );
  if (written.isErr()) {
    throw projectDirectoryBindingErrorToCliError(written.error);
  }

  const ignored = await ensureLocalResolutionPinGitignore(ctx.cwd, ctx.signal);
  if (ignored.isErr()) {
    throw projectDirectoryBindingErrorToCliError(ignored.error);
  }

  return {
    workspace,
    project,
    directory: `./${path.basename(ctx.cwd)}`,
    localPin: { path: LOCAL_RESOLUTION_PIN_RELATIVE_PATH, written: true },
    action,
  };
}
