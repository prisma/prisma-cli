import path from "node:path";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import type {
  AppProvider,
  BranchDatabaseRecord,
  EnvironmentVariableRecord,
} from "../../lib/app/app-provider";
import {
  type BranchDatabaseSchema,
  type BranchDatabaseSignal,
  hasBranchDatabaseSignal,
  inspectBranchDatabaseSignal,
  type UnsupportedBranchDatabaseSchema,
} from "../../lib/app/branch-database";
import { formatCommandArgument } from "../../lib/project/setup";
import {
  adviceAction,
  branchDatabaseSetupFailedError,
  runCommandAction,
} from "./errors";
import type { ServiceBranchDatabaseResult } from "./results";
import type { ServiceContext } from "./target";

export interface BranchDatabaseBranch {
  id: string;
  name: string;
  kind: "production" | "preview";
}

export interface BranchDatabaseOutcome {
  result: ServiceBranchDatabaseResult | undefined;
  diagnostics: Diagnostic[];
}

interface BranchDatabaseEnvState {
  targetDatabaseUrl: EnvironmentVariableRecord | null;
  targetDirectUrl: EnvironmentVariableRecord | null;
  inheritedPreviewDatabaseUrl: EnvironmentVariableRecord | null;
}

function advice(summary: string): Diagnostic {
  return {
    code: "SERVICE.BRANCH_DATABASE",
    severity: "warn",
    summary,
    nextActions: [],
  };
}

function none(): BranchDatabaseOutcome {
  return { result: undefined, diagnostics: [] };
}

/**
 * The `--db` flow: decide whether this deploy provisions a branch database,
 * then create it and wire DATABASE_URL/DIRECT_URL for the branch's env
 * scope. A failure after creation deletes the database again so a half-wired
 * branch never survives.
 */
export async function maybeSetupBranchDatabase(
  ctx: ServiceContext,
  provider: AppProvider,
  projectId: string,
  branch: BranchDatabaseBranch,
  options: {
    db: boolean | undefined;
    providedEnvVars: Record<string, string> | undefined;
    firstProductionDeploy: boolean;
    projectDir: string;
  },
): Promise<BranchDatabaseOutcome> {
  if (options.db === false) {
    return none();
  }

  if (hasProvidedDatabaseEnvVars(options.providedEnvVars)) {
    if (options.db === true) {
      throw new CliStructuredError(
        "SERVICE.BRANCH_DATABASE_SETUP_FAILED",
        "Database setup cannot be combined with provided database env vars",
        {
          why: "The deploy command received --db and a DATABASE_URL or DIRECT_URL value from --env.",
          nextActions: [
            adviceAction(
              "Remove the --env database value to let --db create and wire a database, or remove --db to deploy with the provided value.",
            ),
          ],
        },
      );
    }
    return none();
  }

  if (branch.kind === "production" && !options.firstProductionDeploy) {
    if (options.db === true) {
      throw new CliStructuredError(
        "SERVICE.BRANCH_DATABASE_SETUP_FAILED",
        "Database setup is only available during the first production deploy",
        {
          why: "The selected production service already has a live deployment.",
          nextActions: [
            adviceAction(
              "Use project env commands to manage production DATABASE_URL, or deploy a preview branch with --db.",
            ),
            runCommandAction(
              "Add the production variable",
              "project env add DATABASE_URL=<value> --role production",
            ),
          ],
        },
      );
    }
    return none();
  }

  const envState = await inspectEnv(provider, projectId, branch, ctx.signal);
  const targetEnvVars = targetDatabaseEnvVarKeys(envState);

  if (hasExistingDatabaseEnvForTarget(branch, envState)) {
    if (options.db !== true) {
      return none();
    }
    const warning = advice(existingDatabaseEnvWarning(branch, targetEnvVars));
    return {
      result: {
        status: "skipped",
        reason:
          branch.kind === "production"
            ? "production-env-exists"
            : "branch-env-exists",
        envVars: targetEnvVars,
      },
      diagnostics: [warning],
    };
  }

  const localSignal = await inspectBranchDatabaseSignal(
    options.projectDir,
    ctx.signal,
  );
  if (localSignal.unsupportedSchema) {
    if (options.db === true) {
      throw unsupportedSchemaError(
        localSignal.unsupportedSchema,
        branch,
        ctx.cwd,
      );
    }
    return none();
  }

  if (options.db !== true) {
    const hasSignal =
      hasBranchDatabaseSignal(localSignal) ||
      Boolean(envState.inheritedPreviewDatabaseUrl);
    if (!hasSignal) {
      return none();
    }

    ctx.report({
      kind: "message",
      severity: "info",
      text: `Database signal found for ${databaseTargetLabel(branch)}`,
      data: databaseSignalData(ctx.cwd, localSignal, envState),
    });
    const create = await ctx.prompt.confirm(databasePromptMessage(branch), {
      default: false,
    });
    if (!create) {
      // A run that cannot ask resolves the prompt to its default, so the
      // suggestion is recorded either way.
      return {
        result: undefined,
        diagnostics: [advice(promptSkippedAdvice(branch))],
      };
    }
  }

  return setupBranchDatabase(
    ctx,
    provider,
    projectId,
    branch,
    localSignal,
    envState,
    options.projectDir,
  );
}

async function setupBranchDatabase(
  ctx: ServiceContext,
  provider: AppProvider,
  projectId: string,
  branch: BranchDatabaseBranch,
  signal: BranchDatabaseSignal,
  envState: BranchDatabaseEnvState,
  projectDir: string,
): Promise<BranchDatabaseOutcome> {
  ctx.report({ kind: "step-started", step: "branch-database" });
  const database = await provider
    .createBranchDatabase({
      projectId,
      branchId: branch.id,
      branchName: branch.name,
      signal: ctx.signal,
    })
    .catch((error) => {
      ctx.report({
        kind: "step-finished",
        step: "branch-database",
        outcome: "failed",
      });
      throw branchDatabaseSetupFailedError(
        "Failed to create database",
        error,
        branch.name,
      );
    });

  try {
    const envVars = await upsertEnvVars(
      ctx,
      provider,
      projectId,
      branch,
      database,
      envState,
    );
    ctx.report({
      kind: "step-finished",
      step: "branch-database",
      outcome: "ok",
      data: { databaseId: database.id, envVars },
    });

    // The CLI provisions and wires credentials; it never runs schema or
    // migration commands. Env values are write-only on the platform, so the
    // suggestion routes through a one-time connection URL the user mints.
    const schemaCommand = signal.schema
      ? `DATABASE_URL=<url> npx ${schemaSetupCommand(signal.schema.command)} (detected ${path.relative(projectDir, signal.schema.path) || signal.schema.path})`
      : "your own migration tooling";
    return {
      result: {
        status: "created",
        database: { id: database.id, name: database.name },
        envVars,
      },
      diagnostics: [
        advice(
          `The new database is empty. Get a connection URL with \`prisma-cli database connection create ${database.id}\`, then apply your schema with ${schemaCommand}.`,
        ),
      ],
    };
  } catch (error) {
    throw await deleteDatabaseAfterFailure(
      ctx,
      provider,
      database,
      branch,
      error,
    );
  }
}

async function upsertEnvVars(
  ctx: ServiceContext,
  provider: AppProvider,
  projectId: string,
  branch: BranchDatabaseBranch,
  database: BranchDatabaseRecord,
  envState: BranchDatabaseEnvState,
): Promise<string[]> {
  const scope = envScopeForBranch(branch);
  const written: string[] = [];

  await upsertEnvVar(ctx, provider, {
    projectId,
    ...scope,
    key: "DATABASE_URL",
    value: database.databaseUrl,
    existing: envState.targetDatabaseUrl,
    branchName: branch.name,
  });
  written.push("DATABASE_URL");

  if (database.directUrl) {
    await upsertEnvVar(ctx, provider, {
      projectId,
      ...scope,
      key: "DIRECT_URL",
      value: database.directUrl,
      existing: envState.targetDirectUrl,
      branchName: branch.name,
    });
    written.push("DIRECT_URL");
  } else if (branch.kind === "preview" && envState.targetDirectUrl) {
    await provider
      .deleteEnvironmentVariable({
        envVarId: envState.targetDirectUrl.id,
        signal: ctx.signal,
      })
      .catch((error) => {
        throw branchDatabaseSetupFailedError(
          "Failed to remove stale DIRECT_URL",
          error,
          branch.name,
        );
      });
  }

  return written;
}

async function upsertEnvVar(
  ctx: ServiceContext,
  provider: AppProvider,
  options: {
    projectId: string;
    branchId?: string;
    className: "production" | "preview";
    key: "DATABASE_URL" | "DIRECT_URL";
    value: string;
    existing: EnvironmentVariableRecord | null;
    branchName: string;
  },
): Promise<void> {
  if (options.existing) {
    await provider
      .updateEnvironmentVariable({
        envVarId: options.existing.id,
        value: options.value,
        signal: ctx.signal,
      })
      .catch((error) => {
        throw branchDatabaseSetupFailedError(
          `Failed to update ${options.key}`,
          error,
          options.branchName,
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
      signal: ctx.signal,
    })
    .catch((error) => {
      throw branchDatabaseSetupFailedError(
        `Failed to write ${options.key}`,
        error,
        options.branchName,
      );
    });
}

async function deleteDatabaseAfterFailure(
  ctx: ServiceContext,
  provider: AppProvider,
  database: BranchDatabaseRecord,
  branch: BranchDatabaseBranch,
  error: unknown,
): Promise<unknown> {
  const setupError = CliStructuredError.is(error)
    ? error
    : branchDatabaseSetupFailedError(
        "Database setup failed",
        error,
        branch.name,
      );

  try {
    await provider.deleteBranchDatabase({
      databaseId: database.id,
      signal: ctx.signal,
    });
    ctx.report({
      kind: "message",
      severity: "warn",
      text: "Removed the created database after setup failed.",
    });
  } catch (cleanupError) {
    const cleanupWhy =
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
    return new CliStructuredError(setupError.code, setupError.message, {
      why: `${setupError.why ?? "Database setup failed."} Prisma could not delete the created database "${database.name}" (${database.id}): ${cleanupWhy}`,
      meta: {
        ...setupError.meta,
        branch: branch.name,
        databaseId: database.id,
        databaseName: database.name,
        cleanupFailed: true,
      },
      nextActions: [
        adviceAction(
          "Delete the created database from Console or contact Prisma support, then rerun deploy with --db.",
        ),
      ],
      cause: cleanupError,
    });
  }

  return setupError;
}

async function inspectEnv(
  provider: AppProvider,
  projectId: string,
  branch: BranchDatabaseBranch,
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
  const find = (
    rows: EnvironmentVariableRecord[],
    branchId: string | null,
  ): EnvironmentVariableRecord | null =>
    rows.find((row) => row.branchId === branchId) ?? null;

  return {
    targetDatabaseUrl: find(databaseUrlRows, targetBranchId),
    targetDirectUrl: find(directUrlRows, targetBranchId),
    inheritedPreviewDatabaseUrl:
      branch.kind === "preview" ? find(databaseUrlRows, null) : null,
  };
}

function hasProvidedDatabaseEnvVars(
  envVars: Record<string, string> | undefined,
): boolean {
  return Boolean(
    envVars && ("DATABASE_URL" in envVars || "DIRECT_URL" in envVars),
  );
}

function envScopeForBranch(branch: BranchDatabaseBranch): {
  className: "production" | "preview";
  branchId?: string;
} {
  return branch.kind === "production"
    ? { className: "production" }
    : { className: "preview", branchId: branch.id };
}

function targetDatabaseEnvVarKeys(envState: BranchDatabaseEnvState): string[] {
  return [envState.targetDatabaseUrl, envState.targetDirectUrl]
    .filter((variable): variable is EnvironmentVariableRecord =>
      Boolean(variable),
    )
    .map((variable) => variable.key)
    .sort();
}

function hasExistingDatabaseEnvForTarget(
  branch: BranchDatabaseBranch,
  envState: BranchDatabaseEnvState,
): boolean {
  return branch.kind === "production"
    ? Boolean(envState.targetDatabaseUrl || envState.targetDirectUrl)
    : Boolean(envState.targetDatabaseUrl);
}

function existingDatabaseEnvWarning(
  branch: BranchDatabaseBranch,
  envVars: string[],
): string {
  return branch.kind === "production"
    ? `Production already has ${envVars.join(" and ")}. Treating it as BYO database configuration and leaving env vars unchanged.`
    : `Branch "${branch.name}" already has DATABASE_URL. Leaving branch database env vars unchanged.`;
}

function promptSkippedAdvice(branch: BranchDatabaseBranch): string {
  return branch.kind === "production"
    ? "This service appears to use DATABASE_URL. Run service deploy --db to create and wire a Prisma Postgres database for this first production deploy."
    : "This service appears to use DATABASE_URL. Run service deploy --db to create an isolated database for this preview branch.";
}

function databasePromptMessage(branch: BranchDatabaseBranch): string {
  return branch.kind === "production"
    ? "Create a Prisma Postgres database for production?"
    : `Create an isolated database for branch "${branch.name}"?`;
}

function databaseSignalData(
  cwd: string,
  signal: BranchDatabaseSignal,
  envState: BranchDatabaseEnvState,
): Record<string, unknown> {
  return {
    ...(signal.schema
      ? {
          schema:
            path.relative(cwd, signal.schema.path) ||
            defaultSchemaSourcePath(signal.schema),
        }
      : {}),
    ...(signal.databaseUrlReferences.length > 0
      ? { code: signal.databaseUrlReferences.slice(0, 3) }
      : {}),
    ...(envState.inheritedPreviewDatabaseUrl
      ? { inheritedPreviewDatabaseUrl: true }
      : {}),
  };
}

function databaseTargetLabel(branch: BranchDatabaseBranch): string {
  return branch.kind === "production"
    ? `production branch "${branch.name}"`
    : `branch "${branch.name}"`;
}

function schemaSetupCommand(command: BranchDatabaseSchema["command"]): string {
  switch (command) {
    case "migrate-deploy":
      return "prisma migrate deploy";
    case "db-push":
      return "prisma db push";
    case "prisma-next-db-init":
      return "prisma-next db init";
  }
}

function defaultSchemaSourcePath(schema: BranchDatabaseSchema): string {
  return schema.kind === "prisma-next"
    ? "prisma-next.config.ts"
    : "schema.prisma";
}

function unsupportedSchemaError(
  schema: UnsupportedBranchDatabaseSchema,
  branch: BranchDatabaseBranch,
  cwd: string,
): CliStructuredError {
  const sourcePath =
    path.relative(cwd, schema.path) ||
    (schema.kind === "prisma-next" ? "prisma-next.config.ts" : "schema.prisma");
  const targets: Record<UnsupportedBranchDatabaseSchema["target"], string> = {
    cockroachdb: "CockroachDB",
    mongodb: "MongoDB",
    mysql: "MySQL",
    sqlite: "SQLite",
    sqlserver: "SQL Server",
  };
  return new CliStructuredError(
    "SERVICE.BRANCH_DATABASE_SETUP_FAILED",
    "Database setup is not available for this Prisma schema",
    {
      why: `${sourcePath} targets ${targets[schema.target]}, but --db creates Prisma Postgres databases.`,
      nextActions: [
        adviceAction(
          "Use project env commands to provide a database URL, or switch the Prisma schema source to PostgreSQL before using --db.",
        ),
        runCommandAction(
          "Provide the variable",
          branch.kind === "production"
            ? "project env add DATABASE_URL=<value> --role production"
            : `project env add DATABASE_URL=<value> --branch ${formatCommandArgument(branch.name)}`,
        ),
      ],
    },
  );
}
