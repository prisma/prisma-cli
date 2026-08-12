/** Flags, scope resolution and presentation shared by the
 *  `project env *` commands. */
import { type Block, flag, type Presentations } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { resolveScopeToApi } from "../../controllers/app-env";
import type { ResolvedEnvFileScope } from "../../controllers/app-env-file";
import { usageError } from "../../errors";
import { type EnvScope, resolveEnvScope } from "../../lib/app/env-config";
import { scopeLabel } from "../../presenters/app-env";
import type {
  EnvResolvedContext,
  EnvScopeDescriptor,
  EnvVariableMetadata,
} from "../../types/app-env";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { type ProjectCommandContext, resolvePinnedProject } from "./context";

export const roleFlag = flag.enum({
  brief: "Project template scope (production or preview)",
  values: ["production", "preview"],
});

export const projectFlag = flag.string({
  brief: "Project id or name",
  placeholder: "id-or-name",
});

export const branchFlag = flag.string({
  brief: "Preview branch override scope",
  placeholder: "git-name",
});

export const fileFlag = flag.string({
  brief: "Read KEY=VALUE assignments from a dotenv file",
  placeholder: "path",
});

export interface EnvScopeFlags {
  readonly role?: string;
  readonly branch?: string;
  readonly project?: string;
}

export function requireEnvScope(
  flags: EnvScopeFlags,
  command: "add" | "update" | "remove",
): EnvScope {
  const scope = resolveEnvScope(
    { roleName: flags.role, branchName: flags.branch },
    { requireExplicit: true, command },
  );
  if (!scope) {
    throw usageError(
      `prisma-cli project env ${command} requires --role or --branch`,
      "Writing without an explicit scope is rejected.",
      "Pass --role production, --role preview, or --branch <git-name>.",
      [`prisma-cli project env ${command} KEY=value --role production`],
      "app",
    );
  }
  return scope;
}

export interface EnvTarget {
  readonly projectId: string;
  readonly verboseContext: EnvResolvedContext;
  readonly resolved: ResolvedEnvFileScope;
}

/** Workspace, pinned project and the API scope every env write needs. */
export async function resolveEnvTarget(
  ctx: ProjectCommandContext,
  flags: EnvScopeFlags,
  scope: EnvScope,
  commandName: string,
  createBranchIfMissing: boolean,
): Promise<EnvTarget> {
  const workspace = await resolveActiveWorkspace(ctx);
  const target = await resolvePinnedProject(
    ctx,
    workspace,
    flags.project,
    commandName,
  );
  const resolved = await resolveScopeToApi(ctx.api, target.project.id, scope, {
    createBranchIfMissing,
    signal: ctx.signal,
  });

  return {
    projectId: target.project.id,
    verboseContext: {
      workspace,
      project: target.project,
      resolution: target.resolution,
    },
    resolved,
  };
}

/** The human table's rows: the first cell glues the key to where the
 *  value comes from, which is what a reader wants to see. */
export function variableRows(
  variables: readonly EnvVariableMetadata[],
): string[][] {
  return variables.map((variable) => [
    `${variable.key} (${variable.source})`,
    variable.id,
    variable.isManagedBySystem ? "default" : "",
  ]);
}

/** The stdout lane's rows: the bare key, because a consumer piping this
 *  should not have to split on `" ("` to recover it (conventions §8 —
 *  the stdout lane carries data, not decoration). The source is in the
 *  `--json` record. */
export function variableStdoutRows(
  variables: readonly EnvVariableMetadata[],
): string[][] {
  return variables.map((variable) => [
    variable.key,
    variable.id,
    variable.isManagedBySystem ? "default" : "",
  ]);
}

export function variableFieldRows(
  projectId: string,
  scope: EnvScopeDescriptor,
  variable: EnvVariableMetadata,
) {
  return [
    { label: "project", value: projectId },
    { label: "scope", value: scopeLabel(scope) },
    { label: "key", value: variable.key },
    { label: "id", value: variable.id },
    { label: "last updated", value: variable.updatedAt },
  ];
}

export function fileWritePresentations(input: {
  readonly title: string;
  readonly emptyMessage: string;
  readonly scope: EnvScopeDescriptor;
  readonly filePath: string;
  readonly variables: readonly EnvVariableMetadata[];
}): Presentations {
  const rows = variableRows(input.variables);
  return {
    human: (): Block[] => [
      { kind: "summary", status: "info", text: input.title },
      {
        kind: "fields",
        rows: [
          {
            label: "target",
            value: `${scopeLabel(input.scope)} from ${input.filePath}`,
          },
        ],
      },
      ...(rows.length === 0
        ? [{ kind: "list" as const, items: [input.emptyMessage] }]
        : [
            {
              kind: "table" as const,
              columns: ["variable", "id", "status"],
              rows,
            },
          ]),
    ],
  };
}

/** The legacy "the key has no preview default" warnings, which the v8
 *  envelope carries as warn diagnostics. */
export function previewDefaultDiagnostics(
  warnings: readonly string[],
): Diagnostic[] {
  return warnings.map((warning) => ({
    code: "PROJECT.ENV_PREVIEW_DEFAULT_MISSING" as const,
    severity: "warn" as const,
    summary: warning,
    nextActions: [],
  }));
}
