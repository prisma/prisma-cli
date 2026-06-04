import path from "node:path";

import type { AppDeployResult } from "../../types/app";
import { CliError, usageError } from "../../shell/errors";
import { confirmPrompt } from "../../shell/prompt";
import type { CommandContext } from "../../shell/runtime";
import { canPrompt } from "../../shell/runtime";
import { renderSummaryLine } from "../../shell/ui";
import { formatCommandArgument } from "../project/setup";
import type {
  PreviewAppProvider,
  PreviewBranchDatabaseRecord,
  PreviewEnvironmentVariableRecord,
} from "./preview-provider";
import {
  hasBranchDatabaseSignal,
  inspectBranchDatabaseSignal,
  runBranchDatabaseSchemaSetup,
  type BranchDatabaseSchemaSetupResult,
  type BranchDatabaseSignal,
} from "./branch-database";

export interface BranchDatabaseDeployBranch {
  id: string;
  name: string;
  kind: "production" | "preview";
}

export interface BranchDatabaseSetupOutcome {
  result: AppDeployResult["branchDatabase"] | undefined;
  warnings: string[];
}

interface BranchDatabaseEnvState {
  branchDatabaseUrl: PreviewEnvironmentVariableRecord | null;
  branchDirectUrl: PreviewEnvironmentVariableRecord | null;
  previewDatabaseUrl: PreviewEnvironmentVariableRecord | null;
}

export async function maybeSetupBranchDatabase(
  context: CommandContext,
  provider: PreviewAppProvider,
  projectId: string,
  branch: BranchDatabaseDeployBranch,
  options: {
    db: boolean | undefined;
    inlineEnvVars: Record<string, string> | undefined;
  },
): Promise<BranchDatabaseSetupOutcome> {
  if (options.db === false) {
    return emptyBranchDatabaseSetupOutcome();
  }

  if (hasInlineDatabaseEnvVars(options.inlineEnvVars)) {
    if (options.db === true) {
      throw usageError(
        "Branch database setup cannot be combined with inline database env vars",
        "The deploy command received --db and an inline DATABASE_URL or DIRECT_URL value.",
        "Remove the inline --env database value to let --db create a branch override, or remove --db to deploy with the provided value.",
        [
          "prisma-cli app deploy --db",
          "prisma-cli app deploy --env DATABASE_URL=postgresql://example",
        ],
        "app",
      );
    }

    return emptyBranchDatabaseSetupOutcome();
  }

  if (branch.kind === "production") {
    if (options.db === true) {
      throw usageError(
        "Branch database setup is only available for preview branches",
        "Production database wiring is a durable environment decision and is not created implicitly by app deploy.",
        "Use project env commands to manage production DATABASE_URL, or deploy a preview branch with --db.",
        [
          "prisma-cli project env add DATABASE_URL=<value> --role production",
          "prisma-cli app deploy --branch feature/db --db",
        ],
        "app",
      );
    }

    return emptyBranchDatabaseSetupOutcome();
  }

  const localSignal = await inspectBranchDatabaseSignal(context.runtime.cwd, context.runtime.signal);
  const envState = await inspectBranchDatabaseEnv(provider, projectId, branch.id, context.runtime.signal);
  const branchEnvVars = [envState.branchDatabaseUrl, envState.branchDirectUrl]
    .filter((variable): variable is PreviewEnvironmentVariableRecord => Boolean(variable))
    .map((variable) => variable.key)
    .sort();

  if (hasCompleteBranchDatabaseEnv(envState)) {
    const warning = options.db === true
      ? `Branch "${branch.name}" already has DATABASE_URL. Leaving branch database env vars unchanged.`
      : null;
    if (warning) {
      emitBranchDatabaseWarning(context, warning);
    }

    return {
      result: options.db === true
        ? {
            status: "skipped",
            reason: "branch-env-exists",
            envVars: branchEnvVars,
            schema: null,
          }
        : undefined,
      warnings: warning ? [warning] : [],
    };
  }

  if (options.db !== true && envState.branchDatabaseUrl) {
    return emptyBranchDatabaseSetupOutcome();
  }

  const hasSignal = hasBranchDatabaseSignal(localSignal) || Boolean(envState.previewDatabaseUrl);
  if (options.db !== true) {
    if (!hasSignal) {
      return emptyBranchDatabaseSetupOutcome();
    }

    if (!canPrompt(context) || context.flags.yes) {
      const warning = "This app appears to use DATABASE_URL. Run prisma-cli app deploy --db to create an isolated database for this preview branch.";
      emitBranchDatabaseWarning(context, warning);
      return {
        result: undefined,
        warnings: [warning],
      };
    }

    maybeRenderBranchDatabaseSignal(context, branch.name, localSignal, envState);
    const shouldCreate = await confirmPrompt({
      input: context.runtime.stdin,
      output: context.output.stderr,
      message: `Create an isolated database for branch "${branch.name}"?`,
      initialValue: false,
    });

    if (!shouldCreate) {
      return emptyBranchDatabaseSetupOutcome();
    }
  }

  return setupBranchDatabase(context, provider, projectId, branch, localSignal, envState);
}

async function setupBranchDatabase(
  context: CommandContext,
  provider: PreviewAppProvider,
  projectId: string,
  branch: BranchDatabaseDeployBranch,
  signal: BranchDatabaseSignal,
  envState: BranchDatabaseEnvState,
): Promise<BranchDatabaseSetupOutcome> {
  emitBranchDatabaseProgress(context, "pending", "Creating branch database");
  const database = await provider.createBranchDatabase({
    projectId,
    branchId: branch.id,
    branchName: branch.name,
    signal: context.runtime.signal,
  }).catch((error) => {
    throw branchDatabaseSetupFailedError("Failed to create branch database", error, branch.name);
  });
  emitBranchDatabaseProgress(context, "success", "Created branch database");

  let schemaSetup: BranchDatabaseSchemaSetupResult | null = null;
  const warnings: string[] = [];
  let skippedSchemaWarning: string | null = null;
  if (signal.schema) {
    emitBranchDatabaseProgress(context, "pending", `Applying database schema with ${formatSchemaSetupCommand(signal.schema.command)}`);
    schemaSetup = await runBranchDatabaseSchemaSetup({
      context,
      schema: signal.schema,
      databaseUrl: database.databaseUrl,
      directUrl: database.directUrl,
    }).catch((error) => {
      throw schemaSetupFailedError(error, signal.schema!, branch.name);
    });
    emitBranchDatabaseProgress(context, "success", "Applied database schema");
  } else {
    skippedSchemaWarning = "No schema.prisma file was found. Branch database env vars were created, but schema setup was skipped.";
  }

  const envVars = await upsertBranchDatabaseEnvVars(context, provider, projectId, branch, database, envState);
  emitBranchDatabaseProgress(context, "success", `Added branch env override${envVars.length === 1 ? "" : "s"} ${envVars.join(", ")}`);
  if (skippedSchemaWarning) {
    emitBranchDatabaseWarning(context, skippedSchemaWarning);
    warnings.push(skippedSchemaWarning);
  }

  return {
    result: {
      status: "created",
      database: {
        id: database.id,
        name: database.name,
      },
      envVars,
      schema: schemaSetup
        ? {
            command: schemaSetup.command,
            path: schemaSetup.schemaPath,
          }
        : null,
    },
    warnings,
  };
}

async function upsertBranchDatabaseEnvVars(
  context: CommandContext,
  provider: PreviewAppProvider,
  projectId: string,
  branch: BranchDatabaseDeployBranch,
  database: PreviewBranchDatabaseRecord,
  envState: BranchDatabaseEnvState,
): Promise<string[]> {
  const written: string[] = [];
  await upsertBranchDatabaseEnvVar(context, provider, {
    projectId,
    branchId: branch.id,
    className: "preview",
    key: "DATABASE_URL",
    value: database.databaseUrl,
    existing: envState.branchDatabaseUrl,
    branchName: branch.name,
  });
  written.push("DATABASE_URL");

  if (database.directUrl) {
    await upsertBranchDatabaseEnvVar(context, provider, {
      projectId,
      branchId: branch.id,
      className: "preview",
      key: "DIRECT_URL",
      value: database.directUrl,
      existing: envState.branchDirectUrl,
      branchName: branch.name,
    });
    written.push("DIRECT_URL");
  } else if (envState.branchDirectUrl) {
    await provider.deleteEnvironmentVariable({
      envVarId: envState.branchDirectUrl.id,
      signal: context.runtime.signal,
    }).catch((error) => {
      throw branchDatabaseSetupFailedError("Failed to remove stale DIRECT_URL", error, branch.name);
    });
  }

  return written;
}

async function upsertBranchDatabaseEnvVar(
  context: CommandContext,
  provider: PreviewAppProvider,
  options: {
    projectId: string;
    branchId: string;
    className: "preview";
    key: "DATABASE_URL" | "DIRECT_URL";
    value: string;
    existing: PreviewEnvironmentVariableRecord | null;
    branchName: string;
  },
): Promise<void> {
  if (options.existing) {
    await provider.updateEnvironmentVariable({
      envVarId: options.existing.id,
      value: options.value,
      signal: context.runtime.signal,
    }).catch((error) => {
      throw branchDatabaseSetupFailedError(`Failed to update ${options.key}`, error, options.branchName);
    });
    return;
  }

  await provider.createEnvironmentVariable({
    projectId: options.projectId,
    branchId: options.branchId,
    className: options.className,
    key: options.key,
    value: options.value,
    signal: context.runtime.signal,
  }).catch((error) => {
    throw branchDatabaseSetupFailedError(`Failed to write ${options.key}`, error, options.branchName);
  });
}

async function inspectBranchDatabaseEnv(
  provider: PreviewAppProvider,
  projectId: string,
  branchId: string,
  signal: AbortSignal,
): Promise<BranchDatabaseEnvState> {
  const [databaseUrlRows, directUrlRows] = await Promise.all([
    provider.listEnvironmentVariables({
      projectId,
      className: "preview",
      key: "DATABASE_URL",
      signal,
    }),
    provider.listEnvironmentVariables({
      projectId,
      className: "preview",
      key: "DIRECT_URL",
      signal,
    }),
  ]);

  return {
    branchDatabaseUrl: findEnvVar(databaseUrlRows, { branchId }),
    branchDirectUrl: findEnvVar(directUrlRows, { branchId }),
    previewDatabaseUrl: findEnvVar(databaseUrlRows, { branchId: null }),
  };
}

function findEnvVar(
  rows: PreviewEnvironmentVariableRecord[],
  options: { branchId: string | null },
): PreviewEnvironmentVariableRecord | null {
  return rows.find((row) => row.branchId === options.branchId) ?? null;
}

function hasInlineDatabaseEnvVars(envVars: Record<string, string> | undefined): boolean {
  return Boolean(envVars && ("DATABASE_URL" in envVars || "DIRECT_URL" in envVars));
}

function hasCompleteBranchDatabaseEnv(envState: BranchDatabaseEnvState): boolean {
  return Boolean(envState.branchDatabaseUrl && envState.branchDirectUrl);
}

function maybeRenderBranchDatabaseSignal(
  context: CommandContext,
  branchName: string,
  signal: BranchDatabaseSignal,
  envState: BranchDatabaseEnvState,
): void {
  if (context.flags.json || context.flags.quiet) {
    return;
  }

  const rows = [
    signal.schema
      ? `  Schema  ${path.relative(context.runtime.cwd, signal.schema.path) || "schema.prisma"}`
      : null,
    signal.databaseUrlReferences.length > 0
      ? `  Code    ${signal.databaseUrlReferences.slice(0, 3).join(", ")}`
      : null,
    envState.previewDatabaseUrl
      ? "  Env     preview DATABASE_URL is inherited by this branch"
      : null,
  ].filter((row): row is string => Boolean(row));

  context.output.stderr.write(
    `Database signal found for branch "${branchName}"\n`
      + `${rows.join("\n")}\n\n`,
  );
}

function emitBranchDatabaseProgress(
  context: CommandContext,
  status: "pending" | "success",
  message: string,
): void {
  if (context.flags.json || context.flags.quiet) {
    return;
  }

  const line = status === "pending"
    ? `${context.ui.warning("◇")} ${message}...`
    : renderSummaryLine(context.ui, "success", message);
  context.output.stderr.write(`${line}\n`);
}

function emitBranchDatabaseWarning(context: CommandContext, warning: string): void {
  if (context.flags.json || context.flags.quiet) {
    return;
  }

  context.output.stderr.write(`${renderSummaryLine(context.ui, "warning", warning)}\n`);
}

function emptyBranchDatabaseSetupOutcome(): BranchDatabaseSetupOutcome {
  return {
    result: undefined,
    warnings: [],
  };
}

function formatSchemaSetupCommand(command: BranchDatabaseSchemaSetupResult["command"]): string {
  return command === "migrate-deploy"
    ? "prisma migrate deploy"
    : "prisma db push";
}

function branchDatabaseSetupFailedError(summary: string, error: unknown, branchName: string): CliError {
  return new CliError({
    code: "BRANCH_DATABASE_SETUP_FAILED",
    domain: "app",
    summary,
    why: error instanceof Error ? error.message : String(error),
    fix: "Retry the command, or create the branch database and env vars manually with project env commands.",
    debug: formatDebugDetails(error),
    meta: {
      branch: branchName,
    },
    exitCode: 1,
    nextSteps: [
      `prisma-cli app deploy --branch ${formatCommandArgument(branchName)} --db`,
      `prisma-cli project env list --branch ${formatCommandArgument(branchName)}`,
    ],
  });
}

function schemaSetupFailedError(
  error: unknown,
  schema: NonNullable<BranchDatabaseSignal["schema"]>,
  branchName: string,
): CliError {
  return new CliError({
    code: "SCHEMA_SETUP_FAILED",
    domain: "app",
    summary: "Database schema setup failed",
    why: error instanceof Error ? error.message : String(error),
    fix: "Fix the Prisma schema or migrations, then rerun deploy with --db.",
    debug: formatDebugDetails(error),
    meta: {
      branch: branchName,
      schemaPath: schema.path,
      command: schema.command,
    },
    exitCode: 1,
    nextSteps: [
      schema.command === "migrate-deploy"
        ? "npx --no-install prisma migrate deploy"
        : "npx --no-install prisma db push --skip-generate",
      `prisma-cli app deploy --branch ${formatCommandArgument(branchName)} --db`,
    ],
  });
}

function formatDebugDetails(error: unknown): string | null {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return typeof error === "string" ? error : null;
}
