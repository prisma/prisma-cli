/**
 * Glue between the engine command context and the project controllers.
 * The resolution and env-file operations take a controller
 * `CommandContext` but read only `runtime.cwd`, `runtime.env`
 * and `runtime.signal`, so the CLI hands them exactly that.
 */
import path from "node:path";
import type { CommandContext } from "@prisma/cli-engine";
import type { CommandContext as ControllerCommandContext } from "../../controllers/context";
import { listRealWorkspaceProjects } from "../../controllers/project";
import {
  ensureLocalResolutionPinGitignore,
  LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
  writeLocalResolutionPin,
} from "../../lib/project/local-pin";
import {
  type ProjectCandidate,
  projectResolutionErrorToStructured,
  type ResolvedProjectTarget,
  resolveProjectTarget,
} from "../../lib/project/resolution";
import { projectDirectoryBindingErrorToStructured } from "../../lib/project/setup";
import type { AuthWorkspace } from "../../types/auth";
import type { ProjectSetupResult, ProjectSummary } from "../../types/project";

export type ProjectCommandContext = CommandContext<undefined, never>;

/**
 * The controllers' `CommandContext` is typed to the three fields the
 * CLI supplies today, but a controller edit could start reading a
 * fourth. Left alone that surfaces as
 * `Cannot read properties of undefined`, worst case inside
 * `project transfer` after the project has already moved. Refusing the
 * read here names the missing field at the moment it is read instead.
 * Probes pass through rather than throwing: symbols are how the language
 * inspects an object, and `then` is their string-keyed equivalent — the
 * runtime reads it on anything it resolves through a promise. Throwing
 * on a probe would be the very failure this trap exists to remove.
 */
const PROBE_KEYS: ReadonlySet<string> = new Set(["then"]);

function refuseUnknownReads<T extends object>(fields: T, prefix: string): T {
  return new Proxy(fields, {
    get(target, key) {
      if (typeof key !== "string" || key in target || PROBE_KEYS.has(key)) {
        return Reflect.get(target, key);
      }
      throw new Error(
        "the operation-context adapter provides only runtime.cwd, " +
          `runtime.env and runtime.signal; ${prefix}${key} was read`,
      );
    },
  });
}

export function operationContext(
  ctx: ProjectCommandContext,
): ControllerCommandContext {
  const runtime = refuseUnknownReads(
    { cwd: ctx.cwd, env: ctx.env, signal: ctx.signal },
    "runtime.",
  );
  return refuseUnknownReads(
    { runtime },
    "",
  ) as unknown as ControllerCommandContext;
}

export function listWorkspaceProjects(
  ctx: ProjectCommandContext,
): Promise<ProjectCandidate[]> {
  return listRealWorkspaceProjects(ctx.api, ctx.signal);
}

/** Explicit `--project`, else the `.prisma/local.json` pin, else the
 *  setup-required error. An absent `commandName` makes that error read
 *  "this command" and drops its retry step — `branch list`'s legacy
 *  behavior. */
export async function resolvePinnedProject(
  ctx: ProjectCommandContext,
  workspace: AuthWorkspace,
  explicitProject: string | undefined,
  commandName: string | undefined,
): Promise<ResolvedProjectTarget> {
  const target = await resolveProjectTarget({
    context: operationContext(ctx),
    workspace,
    explicitProject,
    listProjects: () => listWorkspaceProjects(ctx),
    commandName,
  });
  if (target.isErr()) {
    throw projectResolutionErrorToStructured(target.error);
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
    throw projectDirectoryBindingErrorToStructured(written.error);
  }

  const ignored = await ensureLocalResolutionPinGitignore(ctx.cwd, ctx.signal);
  if (ignored.isErr()) {
    throw projectDirectoryBindingErrorToStructured(ignored.error);
  }

  return {
    workspace,
    project,
    directory: `./${path.basename(ctx.cwd)}`,
    localPin: { path: LOCAL_RESOLUTION_PIN_RELATIVE_PATH, written: true },
    action,
  };
}
