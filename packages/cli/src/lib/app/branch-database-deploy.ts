import path from "node:path";
import { CliError, usageError } from "../../shell/errors";
import { confirmPrompt } from "../../shell/prompt";
import type { CommandContext } from "../../shell/runtime";
import { canPrompt } from "../../shell/runtime";
import { renderSummaryLine } from "../../shell/ui";
import type { AppDeployResult } from "../../types/app";
import { formatCommandArgument } from "../project/setup";
import {
  type BranchDatabaseSchema,
  type BranchDatabaseSchemaSetupResult,
  type BranchDatabaseSignal,
  hasBranchDatabaseSignal,
  inspectBranchDatabaseSignal,
  runBranchDatabaseSchemaSetup,
  type UnsupportedBranchDatabaseSchema,
} from "./branch-database";
import type {
  PreviewAppProvider,
  PreviewBranchDatabaseRecord,
  PreviewEnvironmentVariableRecord,
} from "./preview-provider";

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
  targetDatabaseUrl: PreviewEnvironmentVariableRecord | null;
  targetDirectUrl: PreviewEnvironmentVariableRecord | null;
  inheritedPreviewDatabaseUrl: PreviewEnvironmentVariableRecord | null;
}

export async function maybeSetupBranchDatabase(
  context: CommandContext,
  provider: PreviewAppProvider,
  projectId: string,
  branch: BranchDatabaseDeployBranch,
  options: {
    db: boolean | undefined;
    providedEnvVars: Record<string, string> | undefined;
    firstProductionDeploy: boolean;
  },
): Promise<BranchDatabaseSetupOutcome> {
  if (options.db === false) {
    return emptyBranchDatabaseSetupOutcome();
  }

  if (hasProvidedDatabaseEnvVars(options.providedEnvVars)) {
    if (options.db === true) {
      throw usageError(
        "Database setup cannot be combined with provided database env vars",
        "The deploy command received --db and a DATABASE_URL or DIRECT_URL value from --env.",
        "Remove the --env database value to let --db create and wire a database, or remove --db to deploy with the provided value.",
        [
          "prisma-cli app deploy --db",
          "prisma-cli app deploy --env DATABASE_URL=postgresql://example",
        ],
        "app",
      );
    }

    return emptyBranchDatabaseSetupOutcome();
  }

  if (branch.kind === "production" && !options.firstProductionDeploy) {
    if (options.db === true) {
      throw productionDatabaseSetupAfterFirstDeployError();
    }

    return emptyBranchDatabaseSetupOutcome();
  }

  const envState = await inspectBranchDatabaseEnv(
    provider,
    projectId,
    branch,
    context.runtime.signal,
  );
  const targetEnvVars = getTargetDatabaseEnvVarKeys(envState);

  if (hasExistingDatabaseEnvForTarget(branch, envState)) {
    const warning =
      options.db === true
        ? existingDatabaseEnvWarning(branch, targetEnvVars)
        : null;
    if (warning) {
      emitBranchDatabaseWarning(context, warning);
    }

    return {
      result:
        options.db === true
          ? {
              status: "skipped",
              reason: existingDatabaseEnvReason(branch),
              envVars: targetEnvVars,
              schema: null,
            }
          : undefined,
      warnings: warning ? [warning] : [],
    };
  }

  const localSignal = await inspectBranchDatabaseSignal(
    context.runtime.cwd,
    context.runtime.signal,
  );
  if (localSignal.unsupportedSchema) {
    if (options.db === true) {
      throw unsupportedBranchDatabaseSchemaError(
        localSignal.unsupportedSchema,
        branch,
        context,
      );
    }

    return emptyBranchDatabaseSetupOutcome();
  }

  const hasSignal =
    hasBranchDatabaseSignal(localSignal) ||
    Boolean(envState.inheritedPreviewDatabaseUrl);
  if (options.db !== true) {
    if (!hasSignal) {
      return emptyBranchDatabaseSetupOutcome();
    }

    if (!canPrompt(context) || context.flags.yes) {
      const warning = databasePromptSuppressedWarning(branch);
      emitBranchDatabaseWarning(context, warning);
      return {
        result: undefined,
        warnings: [warning],
      };
    }

    maybeRenderBranchDatabaseSignal(context, branch, localSignal, envState);
    const shouldCreate = await confirmPrompt({
      input: context.runtime.stdin,
      output: context.output.stderr,
      message: databasePromptMessage(branch),
      initialValue: false,
    });

    if (!shouldCreate) {
      return emptyBranchDatabaseSetupOutcome();
    }
  } else if (!canPrompt(context) && !context.flags.yes) {
    throw nonInteractiveDatabaseSetupRequiresYesError(branch);
  }

  return setupBranchDatabase(
    context,
    provider,
    projectId,
    branch,
    localSignal,
    envState,
  );
}

async function setupBranchDatabase(
  context: CommandContext,
  provider: PreviewAppProvider,
  projectId: string,
  branch: BranchDatabaseDeployBranch,
  signal: BranchDatabaseSignal,
  envState: BranchDatabaseEnvState,
): Promise<BranchDatabaseSetupOutcome> {
  emitBranchDatabaseProgress(context, "pending", "Creating database");
  const database = await provider
    .createBranchDatabase({
      projectId,
      branchId: branch.id,
      branchName: branch.name,
      signal: context.runtime.signal,
    })
    .catch((error) => {
      throw branchDatabaseSetupFailedError(
        "Failed to create database",
        error,
        branch,
      );
    });
  emitBranchDatabaseProgress(context, "success", "Created database");

  try {
    let schemaSetup: BranchDatabaseSchemaSetupResult | null = null;
    const warnings: string[] = [];
    let skippedSchemaWarning: string | null = null;
    if (signal.schema) {
      emitBranchDatabaseProgress(
        context,
        "pending",
        `Applying database schema with ${formatSchemaSetupCommand(signal.schema.command)}`,
      );
      schemaSetup = await runBranchDatabaseSchemaSetup({
        context,
        schema: signal.schema,
        databaseUrl: database.databaseUrl,
        directUrl: database.directUrl,
      }).catch((error) => {
        throw schemaSetupFailedError(
          error,
          signal.schema!,
          branch,
          context.runtime.cwd,
        );
      });
      emitBranchDatabaseProgress(context, "success", "Applied database schema");
    } else {
      skippedSchemaWarning =
        "No supported Prisma schema source was found. Database env vars were created, but schema setup was skipped.";
    }

    const envVars = await upsertBranchDatabaseEnvVars(
      context,
      provider,
      projectId,
      branch,
      database,
      envState,
    );
    emitBranchDatabaseProgress(
      context,
      "success",
      `Added ${envScopeLabel(branch)} env var${envVars.length === 1 ? "" : "s"} ${envVars.join(", ")}`,
    );
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
              source: schemaSetup.source,
              path: schemaSetup.schemaPath,
            }
          : null,
      },
      warnings,
    };
  } catch (error) {
    throw await cleanupCreatedBranchDatabaseAfterFailure(
      context,
      provider,
      database,
      branch,
      error,
    );
  }
}

async function upsertBranchDatabaseEnvVars(
  context: CommandContext,
  provider: PreviewAppProvider,
  projectId: string,
  branch: BranchDatabaseDeployBranch,
  database: PreviewBranchDatabaseRecord,
  envState: BranchDatabaseEnvState,
): Promise<string[]> {
  const scope = envScopeForBranch(branch);
  const written: string[] = [];
  await upsertBranchDatabaseEnvVar(context, provider, {
    projectId,
    ...scope,
    key: "DATABASE_URL",
    value: database.databaseUrl,
    existing: envState.targetDatabaseUrl,
    branch,
  });
  written.push("DATABASE_URL");

  if (database.directUrl) {
    await upsertBranchDatabaseEnvVar(context, provider, {
      projectId,
      ...scope,
      key: "DIRECT_URL",
      value: database.directUrl,
      existing: envState.targetDirectUrl,
      branch,
    });
    written.push("DIRECT_URL");
  } else if (branch.kind === "preview" && envState.targetDirectUrl) {
    await provider
      .deleteEnvironmentVariable({
        envVarId: envState.targetDirectUrl.id,
        signal: context.runtime.signal,
      })
      .catch((error) => {
        throw branchDatabaseSetupFailedError(
          "Failed to remove stale DIRECT_URL",
          error,
          branch,
        );
      });
  }

  return written;
}

async function upsertBranchDatabaseEnvVar(
  context: CommandContext,
  provider: PreviewAppProvider,
  options: {
    projectId: string;
    branchId?: string;
    className: "production" | "preview";
    key: "DATABASE_URL" | "DIRECT_URL";
    value: string;
    existing: PreviewEnvironmentVariableRecord | null;
    branch: BranchDatabaseDeployBranch;
  },
): Promise<void> {
  if (options.existing) {
    await provider
      .updateEnvironmentVariable({
        envVarId: options.existing.id,
        value: options.value,
        signal: context.runtime.signal,
      })
      .catch((error) => {
        throw branchDatabaseSetupFailedError(
          `Failed to update ${options.key}`,
          error,
          options.branch,
        );
      });
    return;
  }

  await provider
    .createEnvironmentVariable({
      projectId: options.projectId,
      className: options.className,
      key: options.key,
      value: options.value,
      ...(options.branchId ? { branchId: options.branchId } : {}),
      signal: context.runtime.signal,
    })
    .catch((error) => {
      throw branchDatabaseSetupFailedError(
        `Failed to write ${options.key}`,
        error,
        options.branch,
      );
    });
}

async function inspectBranchDatabaseEnv(
  provider: PreviewAppProvider,
  projectId: string,
  branch: BranchDatabaseDeployBranch,
  signal: AbortSignal,
): Promise<BranchDatabaseEnvState> {
  const scope = envScopeForBranch(branch);
  const [databaseUrlRows, directUrlRows] = await Promise.all([
    provider.listEnvironmentVariables({
      projectId,
      className: scope.className,
      key: "DATABASE_URL",
      signal,
    }),
    provider.listEnvironmentVariables({
      projectId,
      className: scope.className,
      key: "DIRECT_URL",
      signal,
    }),
  ]);
  const targetBranchId = branch.kind === "preview" ? branch.id : null;

  return {
    targetDatabaseUrl: findEnvVar(databaseUrlRows, {
      branchId: targetBranchId,
    }),
    targetDirectUrl: findEnvVar(directUrlRows, { branchId: targetBranchId }),
    inheritedPreviewDatabaseUrl:
      branch.kind === "preview"
        ? findEnvVar(databaseUrlRows, { branchId: null })
        : null,
  };
}

function findEnvVar(
  rows: PreviewEnvironmentVariableRecord[],
  options: { branchId: string | null },
): PreviewEnvironmentVariableRecord | null {
  return rows.find((row) => row.branchId === options.branchId) ?? null;
}

function hasProvidedDatabaseEnvVars(
  envVars: Record<string, string> | undefined,
): boolean {
  return Boolean(
    envVars && ("DATABASE_URL" in envVars || "DIRECT_URL" in envVars),
  );
}

function envScopeForBranch(branch: BranchDatabaseDeployBranch): {
  className: "production" | "preview";
  branchId?: string;
} {
  return branch.kind === "production"
    ? { className: "production" }
    : { className: "preview", branchId: branch.id };
}

function envScopeLabel(branch: BranchDatabaseDeployBranch): string {
  return branch.kind === "production" ? "production" : "branch";
}

function getTargetDatabaseEnvVarKeys(
  envState: BranchDatabaseEnvState,
): string[] {
  return [envState.targetDatabaseUrl, envState.targetDirectUrl]
    .filter((variable): variable is PreviewEnvironmentVariableRecord =>
      Boolean(variable),
    )
    .map((variable) => variable.key)
    .sort();
}

function hasExistingDatabaseEnvForTarget(
  branch: BranchDatabaseDeployBranch,
  envState: BranchDatabaseEnvState,
): boolean {
  if (branch.kind === "production") {
    return Boolean(envState.targetDatabaseUrl || envState.targetDirectUrl);
  }

  return Boolean(envState.targetDatabaseUrl);
}

function existingDatabaseEnvReason(
  branch: BranchDatabaseDeployBranch,
): "branch-env-exists" | "production-env-exists" {
  return branch.kind === "production"
    ? "production-env-exists"
    : "branch-env-exists";
}

function existingDatabaseEnvWarning(
  branch: BranchDatabaseDeployBranch,
  envVars: string[],
): string {
  if (branch.kind === "production") {
    return `Production already has ${envVars.join(" and ")}. Treating it as BYO database configuration and leaving env vars unchanged.`;
  }

  return `Branch "${branch.name}" already has DATABASE_URL. Leaving branch database env vars unchanged.`;
}

function databasePromptSuppressedWarning(
  branch: BranchDatabaseDeployBranch,
): string {
  if (branch.kind === "production") {
    return "This app appears to use DATABASE_URL. Run prisma-cli app deploy --db --yes to create and wire a Prisma Postgres database for this first production deploy.";
  }

  return "This app appears to use DATABASE_URL. Run prisma-cli app deploy --db to create an isolated database for this preview branch.";
}

function databasePromptMessage(branch: BranchDatabaseDeployBranch): string {
  return branch.kind === "production"
    ? "Create a Prisma Postgres database for production?"
    : `Create an isolated database for branch "${branch.name}"?`;
}

function maybeRenderBranchDatabaseSignal(
  context: CommandContext,
  branch: BranchDatabaseDeployBranch,
  signal: BranchDatabaseSignal,
  envState: BranchDatabaseEnvState,
): void {
  if (context.flags.json || context.flags.quiet) {
    return;
  }

  const rows = [
    signal.schema
      ? `  Schema  ${path.relative(context.runtime.cwd, signal.schema.path) || defaultSchemaSourcePath(signal.schema)}`
      : null,
    signal.databaseUrlReferences.length > 0
      ? `  Code    ${signal.databaseUrlReferences.slice(0, 3).join(", ")}`
      : null,
    envState.inheritedPreviewDatabaseUrl
      ? "  Env     preview DATABASE_URL is inherited by this branch"
      : null,
  ].filter((row): row is string => Boolean(row));

  context.output.stderr.write(
    `Database signal found for ${databaseTargetLabel(branch)}\n` +
      `${rows.join("\n")}\n\n`,
  );
}

function databaseTargetLabel(branch: BranchDatabaseDeployBranch): string {
  return branch.kind === "production"
    ? `production branch "${branch.name}"`
    : `branch "${branch.name}"`;
}

function emitBranchDatabaseProgress(
  context: CommandContext,
  status: "pending" | "success",
  message: string,
): void {
  if (context.flags.json || context.flags.quiet) {
    return;
  }

  const line =
    status === "pending"
      ? `${context.ui.warning("◇")} ${message}...`
      : renderSummaryLine(context.ui, "success", message);
  context.output.stderr.write(`${line}\n`);
}

function emitBranchDatabaseWarning(
  context: CommandContext,
  warning: string,
): void {
  if (context.flags.json || context.flags.quiet) {
    return;
  }

  context.output.stderr.write(
    `${renderSummaryLine(context.ui, "warning", warning)}\n`,
  );
}

function emptyBranchDatabaseSetupOutcome(): BranchDatabaseSetupOutcome {
  return {
    result: undefined,
    warnings: [],
  };
}

function productionDatabaseSetupAfterFirstDeployError(): CliError {
  return usageError(
    "Database setup is only available during the first production deploy",
    "The selected production app already has a live deployment.",
    "Use project env commands to manage production DATABASE_URL, or deploy a preview branch with --db.",
    [
      "prisma-cli project env add DATABASE_URL=<value> --role production",
      "prisma-cli app deploy --branch feature/db --db",
    ],
    "app",
  );
}

function nonInteractiveDatabaseSetupRequiresYesError(
  branch: BranchDatabaseDeployBranch,
): CliError {
  const command =
    branch.kind === "production"
      ? "prisma-cli app deploy --prod --db --yes"
      : `prisma-cli app deploy --branch ${formatCommandArgument(branch.name)} --db --yes`;

  return usageError(
    "Database setup requires --yes in non-interactive mode",
    "The deploy command received --db, but prompts are not available and --yes was not passed.",
    "Pass --yes together with --db to confirm non-interactive database creation.",
    [command],
    "app",
  );
}

function formatSchemaSetupCommand(
  command: BranchDatabaseSchemaSetupResult["command"],
): string {
  switch (command) {
    case "migrate-deploy":
      return "prisma migrate deploy";
    case "db-push":
      return "prisma db push";
    case "prisma-next-db-init":
      return "prisma-next db init";
  }
}

function branchDatabaseSetupFailedError(
  summary: string,
  error: unknown,
  branch: BranchDatabaseDeployBranch,
): CliError {
  return new CliError({
    code: "BRANCH_DATABASE_SETUP_FAILED",
    domain: "app",
    summary,
    why: error instanceof Error ? error.message : String(error),
    fix: "Retry the command, or create the database and env vars manually with project env commands.",
    debug: formatDebugDetails(error),
    meta: {
      branch: branch.name,
    },
    exitCode: 1,
    nextSteps: [
      formatAppDeployWithDbNextStep(branch),
      formatProjectEnvListNextStep(branch),
    ],
  });
}

async function cleanupCreatedBranchDatabaseAfterFailure(
  context: CommandContext,
  provider: PreviewAppProvider,
  database: PreviewBranchDatabaseRecord,
  branch: BranchDatabaseDeployBranch,
  error: unknown,
): Promise<CliError> {
  const setupError =
    error instanceof CliError
      ? error
      : branchDatabaseSetupFailedError("Database setup failed", error, branch);

  emitBranchDatabaseProgress(
    context,
    "pending",
    "Removing database after setup failed",
  );
  try {
    await provider.deleteBranchDatabase({
      databaseId: database.id,
      signal: context.runtime.signal,
    });
    emitBranchDatabaseProgress(
      context,
      "success",
      "Removed database after setup failed",
    );
  } catch (cleanupError) {
    return branchDatabaseCleanupFailedError(
      setupError,
      cleanupError,
      database,
      branch,
    );
  }

  return setupError;
}

function branchDatabaseCleanupFailedError(
  setupError: CliError,
  cleanupError: unknown,
  database: PreviewBranchDatabaseRecord,
  branch: BranchDatabaseDeployBranch,
): CliError {
  const cleanupWhy =
    cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  const setupWhy = setupError.why ?? "Database setup failed.";

  return new CliError({
    code: setupError.code,
    domain: setupError.domain,
    summary: setupError.summary,
    why: `${setupWhy} Prisma could not delete the created database "${database.name}" (${database.id}): ${cleanupWhy}`,
    fix: "Delete the created database from Console or contact Prisma support, then rerun deploy with --db.",
    debug: formatCombinedDebugDetails(setupError, cleanupError),
    meta: {
      ...setupError.meta,
      branch: branch.name,
      databaseId: database.id,
      databaseName: database.name,
      cleanupFailed: true,
    },
    exitCode: setupError.exitCode,
    nextSteps: [],
  });
}

function schemaSetupFailedError(
  error: unknown,
  schema: BranchDatabaseSchema,
  branch: BranchDatabaseDeployBranch,
  cwd: string,
): CliError {
  return new CliError({
    code: "SCHEMA_SETUP_FAILED",
    domain: "app",
    summary: "Database schema setup failed",
    why: error instanceof Error ? error.message : String(error),
    fix: "Fix the Prisma schema or migrations, then rerun deploy with --db.",
    debug: formatDebugDetails(error),
    meta: {
      branch: branch.name,
      schemaPath: schema.path,
      source: schema.kind,
      command: schema.command,
    },
    exitCode: 1,
    nextSteps: [
      ...formatSchemaSetupNextSteps(schema, cwd),
      formatAppDeployWithDbNextStep(branch),
    ],
  });
}

function unsupportedBranchDatabaseSchemaError(
  schema: UnsupportedBranchDatabaseSchema,
  branch: BranchDatabaseDeployBranch,
  context: CommandContext,
): CliError {
  const sourcePath =
    path.relative(context.runtime.cwd, schema.path) ||
    defaultUnsupportedSchemaSourcePath(schema);
  return usageError(
    "Database setup is not available for this Prisma schema",
    `${sourcePath} targets ${formatUnsupportedSchemaTarget(schema.target)}, but --db creates Prisma Postgres databases.`,
    "Use project env commands to provide a database URL, or switch the Prisma schema source to PostgreSQL before using --db.",
    [
      formatProjectEnvAddNextStep(branch),
      `prisma-cli app deploy --branch ${formatCommandArgument(branch.name)}`,
    ],
    "app",
  );
}

function formatAppDeployWithDbNextStep(
  branch: BranchDatabaseDeployBranch,
): string {
  return `prisma-cli app deploy --branch ${formatCommandArgument(branch.name)} --db`;
}

function formatProjectEnvListNextStep(
  branch: BranchDatabaseDeployBranch,
): string {
  return branch.kind === "production"
    ? "prisma-cli project env list --role production"
    : `prisma-cli project env list --branch ${formatCommandArgument(branch.name)}`;
}

function formatProjectEnvAddNextStep(
  branch: BranchDatabaseDeployBranch,
): string {
  return branch.kind === "production"
    ? "prisma-cli project env add DATABASE_URL=<value> --role production"
    : `prisma-cli project env add DATABASE_URL=<value> --branch ${formatCommandArgument(branch.name)}`;
}

function formatSchemaSetupNextSteps(
  schema: BranchDatabaseSchema,
  cwd: string,
): string[] {
  const sourcePath =
    path.relative(cwd, schema.path) || defaultSchemaSourcePath(schema);
  switch (schema.command) {
    case "migrate-deploy":
      return [
        `npx --no-install prisma migrate deploy --schema ${formatCommandArgument(sourcePath)}`,
      ];
    case "db-push":
      return [
        `npx --no-install prisma db push --schema ${formatCommandArgument(sourcePath)}`,
      ];
    case "prisma-next-db-init":
      return [
        `npx --no-install prisma-next contract emit --config ${formatCommandArgument(sourcePath)}`,
        `npx --no-install prisma-next db init --config ${formatCommandArgument(sourcePath)} --db <DATABASE_URL>`,
      ];
  }
}

function defaultSchemaSourcePath(schema: BranchDatabaseSchema): string {
  return schema.kind === "prisma-next"
    ? "prisma-next.config.ts"
    : "schema.prisma";
}

function defaultUnsupportedSchemaSourcePath(
  schema: UnsupportedBranchDatabaseSchema,
): string {
  return schema.kind === "prisma-next"
    ? "prisma-next.config.ts"
    : "schema.prisma";
}

function formatUnsupportedSchemaTarget(
  target: UnsupportedBranchDatabaseSchema["target"],
): string {
  switch (target) {
    case "cockroachdb":
      return "CockroachDB";
    case "mongodb":
      return "MongoDB";
    case "mysql":
      return "MySQL";
    case "sqlite":
      return "SQLite";
    case "sqlserver":
      return "SQL Server";
  }
}

function formatDebugDetails(error: unknown): string | null {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return typeof error === "string" ? error : null;
}

function formatCombinedDebugDetails(
  setupError: CliError,
  cleanupError: unknown,
): string | null {
  const setupDebug = setupError.debug ?? setupError.stack ?? setupError.message;
  const cleanupDebug = formatDebugDetails(cleanupError);

  return (
    [
      setupDebug ? `Setup error:\n${setupDebug}` : null,
      cleanupDebug ? `Cleanup error:\n${cleanupDebug}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n\n") || null
  );
}
