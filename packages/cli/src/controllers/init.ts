import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  COMPUTE_CONFIG_FILENAME,
  COMPUTE_CONFIG_JSON_FILENAME,
  COMPUTE_REGIONS,
  type ComputeConfig,
  type ComputeFramework,
  type ComputeRegion,
  defaultHttpPortForBuildType,
  FRAMEWORKS,
  findComputeConfigCandidates,
  findComputeConfigDir,
  frameworkByKey,
  frameworkFromAlias,
  type LoadedComputeConfig,
  normalizeComputeConfig,
  serializeComputeConfig,
  serializeComputeConfigJson,
} from "@prisma/compute-sdk/config";
import { execa } from "execa";

import {
  type PrismaCliPackageCommandFormatter,
  resolvePrismaCliPackageCommandFormatterSync,
} from "../lib/agent/cli-command";
import {
  type AgentPackageManager,
  detectPackageManagerSync,
} from "../lib/agent/package-manager";
import {
  readBunPackageEntrypoint,
  readBunPackageJson,
} from "../lib/app/bun-project";
import { readLocalResolutionPin } from "../lib/project/local-pin";
import { CliError, usageError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import {
  confirmPrompt,
  isPromptCancelError,
  selectPrompt,
  textPrompt,
} from "../shell/prompt";
import { type CommandContext, canPrompt } from "../shell/runtime";
import type {
  InitConfigFormat,
  InitLinkState,
  InitResult,
  InitSettingRow,
  InitTypesState,
} from "../types/init";
import { maybePromptForAgentSetup } from "./agent-setup";
import { detectDeployFramework } from "./app";
import { runProjectLink } from "./project";

export interface InitFlags {
  framework?: string;
  entry?: string;
  httpPort?: string;
  region?: string;
  name?: string;
  link?: boolean;
  project?: string;
  install?: boolean;
  format?: string;
}

interface ResolvedInitFramework {
  key: ComputeFramework;
  displayName: string;
  source: string;
}

export async function runInit(
  context: CommandContext,
  flags: InitFlags,
): Promise<CommandSuccess<InitResult>> {
  const cwd = context.runtime.cwd;
  const signal = context.runtime.signal;
  // User-facing command hints use the project's package runner (pnpm dlx,
  // bunx, npx -y), matching the agent group's convention.
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(cwd);

  const format = parseInitFormat(flags.format, formatCommand);
  if (format.value === "json" && flags.install === true) {
    throw usageError(
      "--install does not apply to the JSON config format",
      `${COMPUTE_CONFIG_JSON_FILENAME} is a dependency-free static config; the ${COMPUTE_SDK_PACKAGE} devDependency exists only for ${COMPUTE_CONFIG_FILENAME} editor types.`,
      "Drop --install, or use the TypeScript format.",
      [formatCommand(["init", "--format", "json"])],
      "app",
    );
  }

  const existingConfig = await findExistingComputeConfig(cwd, signal);
  if (existingConfig) {
    const solePath =
      existingConfig.candidates.length === 1
        ? existingConfig.candidates[0]
        : undefined;
    const soleIsJson =
      solePath !== undefined && path.extname(solePath) === ".json";
    // Conversion must be explicit: plain init refuses every existing config.
    if (soleIsJson && format.value === "typescript" && format.explicit) {
      rejectConversionResolutionFlags(flags, formatCommand);
      return runInitConversion(context, flags, solePath, formatCommand);
    }
    if (solePath && !soleIsJson && format.value === "json") {
      throw initConvertUnsupportedError(solePath);
    }
    throw initConfigExistsError(
      existingConfig.candidates[0] ?? existingConfig.directory,
    );
  }

  const region = parseInitRegion(flags.region, formatCommand);
  let framework = await resolveInitFramework(context, flags, formatCommand);
  const name = await resolveInitAppName(cwd, flags.name, signal, formatCommand);
  let httpPort = parseInitHttpPort(flags.httpPort, formatCommand) ?? {
    value: defaultHttpPortForBuildType(frameworkByKey(framework.key).buildType),
    source: "framework default",
  };
  const adjusted = await maybeAdjustSettings(context, framework, httpPort, {
    portExplicit: flags.httpPort !== undefined,
  });
  framework = adjusted.framework;
  httpPort = adjusted.httpPort;

  // The custom framework needs build.outputDirectory and build.entrypoint,
  // which init does not collect. The TypeScript format carries a commented
  // build stub to fill in; strict JSON cannot hold comments, so refuse here
  // instead of writing a config that deploy would reject.
  if (format.value === "json" && framework.key === "custom") {
    throw usageError(
      "Custom framework requires the TypeScript config format",
      "The custom framework needs build.outputDirectory and build.entrypoint, which init does not collect; the TypeScript format includes a commented build stub to complete, and strict JSON cannot carry it.",
      `Rerun without --format json and fill in the build stub, or write ${COMPUTE_CONFIG_JSON_FILENAME} by hand with a build object.`,
      [formatCommand(["init", "--framework", "custom"])],
      "app",
    );
  }

  // Entry resolves against the FINAL framework so an interactive framework
  // switch cannot leave a stale (or missing) entry in the written config.
  const entry = await resolveInitEntry(cwd, framework, flags.entry, signal);

  const settings: InitSettingRow[] = [
    { key: "app", value: name.value, source: name.source },
    {
      key: "framework",
      value: framework.displayName,
      source: framework.source,
    },
    ...(entry
      ? [{ key: "entry", value: entry.value, source: entry.source }]
      : []),
    {
      key: "http port",
      value: String(httpPort.value),
      source: httpPort.source,
    },
    ...(region ? [{ key: "region", value: region, source: "flag" }] : []),
  ];

  renderInitSettingsPreview(context, settings);

  const config: ComputeConfig = {
    app: {
      name: name.value,
      framework: framework.key,
      httpPort: httpPort.value,
      ...(entry ? { entry: entry.value } : {}),
      ...(region ? { region } : {}),
    },
  };

  const configFilename =
    format.value === "json"
      ? COMPUTE_CONFIG_JSON_FILENAME
      : COMPUTE_CONFIG_FILENAME;
  const configPath = path.join(cwd, configFilename);
  let source: string;
  if (format.value === "json") {
    source = serializeComputeConfigJson(config);
  } else {
    source = serializeComputeConfig(config);
    if (framework.key === "custom") {
      source += CUSTOM_BUILD_STUB;
    }
  }

  signal.throwIfAborted();
  try {
    // wx: fail instead of clobbering a config that appeared since the check.
    await writeFile(configPath, source, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw initConfigExistsError(configPath);
    }
    throw error;
  }

  const warnings: string[] = [];
  // The JSON format exists to be dependency-free, so the types install step
  // never runs for it; validation happens when commands load the config.
  const types: InitTypesState =
    format.value === "json"
      ? {
          status: "skipped",
          package: COMPUTE_SDK_PACKAGE,
          installCommand: null,
        }
      : await resolveInitTypes(context, flags, {
          onWarning: (message) => warnings.push(message),
        });
  const link = await resolveInitLink(context, flags, {
    onWarning: (message) => warnings.push(message),
    formatCommand,
  });
  warnings.push(...(await maybePromptForAgentSetup(context, cwd)));

  const unlinked = link.status !== "linked" && link.status !== "already-linked";
  const typesMissing =
    types.status !== "installed" && types.status !== "already-installed";
  return {
    command: "init",
    result: {
      configPath: configFilename,
      format: format.value,
      converted: false,
      directory: formatInitDirectory(cwd),
      app: {
        name: name.value,
        framework: framework.key,
        httpPort: httpPort.value,
        ...(entry ? { entry: entry.value } : {}),
        ...(region ? { region } : {}),
      },
      settings,
      types,
      link,
    },
    warnings,
    nextSteps: [
      ...(typesMissing && types.installCommand ? [types.installCommand] : []),
      formatCommand(["app", "deploy"]),
      ...(unlinked ? [formatCommand(["project", "link"])] : []),
    ],
  };
}

/** Dev dependency that provides editor types for the generated config. */
const COMPUTE_SDK_PACKAGE = "@prisma/compute-sdk";

function packageAddCommand(packageManager: AgentPackageManager): string[] {
  switch (packageManager) {
    case "pnpm":
      return ["pnpm", "add", "-D", COMPUTE_SDK_PACKAGE];
    case "bun":
      return ["bun", "add", "-d", COMPUTE_SDK_PACKAGE];
    case "yarn":
      return ["yarn", "add", "-D", COMPUTE_SDK_PACKAGE];
    case "npm":
      return ["npm", "install", "-D", COMPUTE_SDK_PACKAGE];
  }
}

/**
 * Offers to install `@prisma/compute-sdk` as a devDependency so the generated
 * config's typed import resolves in the editor. Deploy resolves the import
 * without a local install, so every outcome short of success is a hint, never
 * a failure.
 */
async function resolveInitTypes(
  context: CommandContext,
  flags: InitFlags,
  hooks: { onWarning: (message: string) => void },
): Promise<InitTypesState> {
  const cwd = context.runtime.cwd;
  // This step runs after prisma.compute.ts is written; an unreadable
  // package.json (malformed JSON, permissions) must not turn the already
  // successful write into a command failure, so it degrades to a skip.
  let packageJson: Awaited<ReturnType<typeof readBunPackageJson>>;
  try {
    packageJson = await readBunPackageJson(cwd, context.runtime.signal);
  } catch (error) {
    if (context.runtime.signal.aborted) {
      throw error;
    }
    hooks.onWarning(
      `Skipped the ${COMPUTE_SDK_PACKAGE} types install: package.json could not be read (${error instanceof Error ? error.message.split("\n")[0] : String(error)}).`,
    );
    return {
      status: "skipped",
      package: COMPUTE_SDK_PACKAGE,
      installCommand: null,
    };
  }
  if (hasComputeSdkDependency(packageJson)) {
    return {
      status: "already-installed",
      package: COMPUTE_SDK_PACKAGE,
      installCommand: null,
    };
  }

  const packageManager = detectPackageManagerSync(cwd) ?? "npm";
  const installCommand = packageAddCommand(packageManager);
  const installCommandText = installCommand.join(" ");
  const state = (status: InitTypesState["status"]): InitTypesState => ({
    status,
    package: COMPUTE_SDK_PACKAGE,
    installCommand: installCommandText,
  });

  // A directory without a package.json has nowhere to record the dependency.
  if (!packageJson) {
    return state("skipped");
  }

  if (flags.install === false) {
    return state("skipped");
  }

  let shouldInstall = flags.install === true;
  if (!shouldInstall) {
    if (!canPrompt(context) || context.flags.yes) {
      return state("skipped");
    }
    try {
      shouldInstall = await confirmPrompt({
        input: context.runtime.stdin,
        output: context.output.stderr,
        signal: context.runtime.signal,
        message: `Install ${COMPUTE_SDK_PACKAGE} for config types? (${installCommandText})`,
        initialValue: true,
      });
    } catch (error) {
      if (isPromptCancelError(error)) {
        return state("declined");
      }
      throw error;
    }
    if (!shouldInstall) {
      return state("declined");
    }
  }

  const command = resolveInitInstallCommandOverride(context) ?? installCommand;
  if (!context.flags.quiet && !context.flags.json) {
    context.output.stderr.write(`Installing ${COMPUTE_SDK_PACKAGE}...\n`);
  }
  try {
    const [executable, ...args] = command;
    await execa(executable as string, args, {
      cwd,
      env: context.runtime.env,
      cancelSignal: context.runtime.signal,
      stdin: "ignore",
    });
    return state("installed");
  } catch (error) {
    if (context.runtime.signal.aborted) {
      throw error;
    }
    // execa's first message line is the short "Command failed" summary; the
    // full package-manager output stays out of the warning.
    const detail =
      error instanceof Error ? error.message.split("\n")[0] : String(error);
    hooks.onWarning(
      `Installing ${COMPUTE_SDK_PACKAGE} failed: ${detail}. Install it later with ${installCommandText}.`,
    );
    return state("failed");
  }
}

function hasComputeSdkDependency(
  packageJson: Awaited<ReturnType<typeof readBunPackageJson>>,
): boolean {
  for (const group of [
    packageJson?.dependencies,
    packageJson?.devDependencies,
  ]) {
    if (
      group &&
      typeof group === "object" &&
      COMPUTE_SDK_PACKAGE in (group as Record<string, unknown>)
    ) {
      return true;
    }
  }
  return false;
}

/** Test hook: JSON array command that replaces the real package-manager install. */
function resolveInitInstallCommandOverride(
  context: CommandContext,
): string[] | null {
  const raw = context.runtime.env.PRISMA_CLI_INIT_INSTALL_COMMAND;
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((p) => typeof p === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

const CUSTOM_BUILD_STUB = `
// framework "custom" deploys a prebuilt artifact. Add its build settings:
// build: {
//   command: "npm run build",
//   outputDirectory: "dist",
//   entrypoint: "server.js",
// },
`;

/**
 * Nearest existing compute config, searching from `cwd` up to the source
 * root. Init routes on this: refuse, convert, or proceed fresh.
 */
async function findExistingComputeConfig(
  cwd: string,
  signal: AbortSignal,
): Promise<{ directory: string; candidates: string[] } | null> {
  const configDir = await findComputeConfigDir(cwd, signal);
  if (!configDir) {
    return null;
  }

  return {
    directory: configDir,
    candidates: await findComputeConfigCandidates(configDir, signal),
  };
}

function parseInitFormat(
  value: string | undefined,
  formatCommand: PrismaCliPackageCommandFormatter,
): { value: InitConfigFormat; explicit: boolean } {
  if (value === undefined) {
    return { value: "typescript", explicit: false };
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "ts" || normalized === "typescript") {
    return { value: "typescript", explicit: true };
  }
  if (normalized === "json") {
    return { value: "json", explicit: true };
  }

  throw usageError(
    "Unknown config format",
    `"${value}" is not a supported config format.`,
    "Pass --format ts or --format json.",
    [formatCommand(["init", "--format", "json"])],
    "app",
  );
}

/**
 * Conversion transports the existing config's values; it never re-resolves
 * settings. Refusing resolution flags beats silently ignoring them.
 */
function rejectConversionResolutionFlags(
  flags: InitFlags,
  formatCommand: PrismaCliPackageCommandFormatter,
): void {
  const passed = [
    flags.framework !== undefined ? "--framework" : null,
    flags.entry !== undefined ? "--entry" : null,
    flags.httpPort !== undefined ? "--http-port" : null,
    flags.name !== undefined ? "--name" : null,
    flags.region !== undefined ? "--region" : null,
  ].filter((flag): flag is string => flag !== null);
  if (passed.length === 0) {
    return;
  }
  throw usageError(
    `${passed.join(", ")} ${passed.length === 1 ? "does" : "do"} not apply when converting an existing config`,
    `--format ts with an existing ${COMPUTE_CONFIG_JSON_FILENAME} converts it as-is; settings are transported, never re-resolved.`,
    `Convert first, then edit ${COMPUTE_CONFIG_FILENAME} directly.`,
    [formatCommand(["init", "--format", "ts"])],
    "app",
  );
}

function initConvertIncompleteError(
  jsonConfigPath: string,
  tsConfigPath: string,
): CliError {
  return new CliError({
    code: "INIT_CONVERT_INCOMPLETE",
    domain: "app",
    summary: "Conversion left two config files behind",
    why: `${path.basename(tsConfigPath)} was written but ${path.basename(jsonConfigPath)} could not be deleted, and rolling back the write also failed. Commands refuse to load a directory with two config files.`,
    fix: `Delete one file by hand: keep ${path.basename(tsConfigPath)} to finish the conversion, or keep ${path.basename(jsonConfigPath)} to undo it.`,
    exitCode: 1,
    nextSteps: [],
    meta: { jsonConfigPath, tsConfigPath },
  });
}

function initConvertUnsupportedError(existingPath: string): CliError {
  return new CliError({
    code: "INIT_CONVERT_UNSUPPORTED",
    domain: "app",
    summary: "TypeScript configs do not convert to JSON",
    why: `${existingPath} may contain imports, expressions, or comments that the static ${COMPUTE_CONFIG_JSON_FILENAME} format cannot express, so an automatic conversion would be lossy.`,
    fix: `If the config is fully static, rewrite it by hand as ${COMPUTE_CONFIG_JSON_FILENAME} and delete ${path.basename(existingPath)}.`,
    exitCode: 1,
    nextSteps: [],
    meta: { existingConfigPath: existingPath },
  });
}

/**
 * The graduation path: an explicit `--format ts` with an existing
 * `prisma.compute.json` rewrites the same config as `prisma.compute.ts` and
 * deletes the JSON file, so a static config can grow into a programmatic one.
 * The values are transported, never re-resolved.
 */
async function runInitConversion(
  context: CommandContext,
  flags: InitFlags,
  jsonConfigPath: string,
  formatCommand: PrismaCliPackageCommandFormatter,
): Promise<CommandSuccess<InitResult>> {
  const cwd = context.runtime.cwd;
  const signal = context.runtime.signal;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(jsonConfigPath, "utf8"));
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw initConvertInvalidError(jsonConfigPath, [
      error instanceof Error
        ? (error.message.split("\n")[0] as string)
        : String(error),
    ]);
  }

  // "$schema" is editor tooling metadata, not config; the TypeScript format
  // carries types through its import instead.
  const config = stripJsonSchemaKey(parsed);
  const normalized = normalizeComputeConfig(config, jsonConfigPath);
  if (normalized.isErr()) {
    throw initConvertInvalidError(jsonConfigPath, normalized.error.issues);
  }
  const loaded = normalized.value;

  const tsConfigPath = path.join(loaded.configDir, COMPUTE_CONFIG_FILENAME);
  const source = serializeComputeConfig(config as ComputeConfig);

  signal.throwIfAborted();
  try {
    // wx: fail instead of clobbering a config that appeared since discovery.
    await writeFile(tsConfigPath, source, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw initConfigExistsError(tsConfigPath);
    }
    throw error;
  }
  try {
    await rm(jsonConfigPath);
  } catch (error) {
    // Two coexisting config files are a hard loader error, so a failed
    // delete rolls the write back and leaves the JSON config untouched.
    try {
      await rm(tsConfigPath, { force: true });
    } catch {
      throw initConvertIncompleteError(jsonConfigPath, tsConfigPath);
    }
    throw error;
  }

  const settings = conversionSettings(loaded);
  renderInitSettingsPreview(context, settings);

  const warnings: string[] = [];
  // Conversion transports the config's values but its side-effect steps
  // behave exactly like fresh init: install flags feed resolveInitTypes,
  // and link flags (--link/--no-link/--project) resolve via resolveInitLink
  // instead of being silently ignored. Both act on the config's home, not
  // the invocation directory: discovery may have found the config in an
  // ancestor, and the types dependency and project pin belong where the
  // config lives (fresh init has no such split; it writes at cwd).
  const stepContext = withRuntimeCwd(context, loaded.configDir);
  const types = await resolveInitTypes(stepContext, flags, {
    onWarning: (message) => warnings.push(message),
  });
  const link = await resolveInitLink(stepContext, flags, {
    onWarning: (message) => warnings.push(message),
    formatCommand,
  });
  warnings.push(
    ...(await maybePromptForAgentSetup(stepContext, loaded.configDir)),
  );

  const unlinked = link.status !== "already-linked" && link.status !== "linked";
  const typesMissing =
    types.status !== "installed" && types.status !== "already-installed";
  return {
    command: "init",
    result: {
      configPath: path.relative(cwd, tsConfigPath) || COMPUTE_CONFIG_FILENAME,
      format: "typescript",
      converted: true,
      directory: formatInitDirectory(loaded.configDir),
      app: conversionApp(loaded),
      settings,
      types,
      link,
    },
    warnings,
    nextSteps: [
      ...(typesMissing && types.installCommand ? [types.installCommand] : []),
      formatCommand(["app", "deploy"]),
      ...(unlinked ? [formatCommand(["project", "link"])] : []),
    ],
  };
}

/** The same command context, acting from `cwd` instead of the invocation directory. */
function withRuntimeCwd(context: CommandContext, cwd: string): CommandContext {
  if (path.resolve(context.runtime.cwd) === path.resolve(cwd)) {
    return context;
  }
  return { ...context, runtime: { ...context.runtime, cwd } };
}

function stripJsonSchemaKey(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  const { $schema: _schema, ...config } = parsed as Record<string, unknown>;
  return config;
}

function initConvertInvalidError(
  jsonConfigPath: string,
  issues: string[],
): CliError {
  return new CliError({
    code: "COMPUTE_CONFIG_INVALID",
    domain: "app",
    summary: `Invalid ${path.basename(jsonConfigPath)}`,
    why: issues.join(" "),
    fix: `Fix ${path.basename(jsonConfigPath)} and rerun the conversion.`,
    where: jsonConfigPath,
    meta: { configPath: jsonConfigPath, issues },
    exitCode: 2,
    nextSteps: [],
  });
}

/** Preview rows for a conversion; every value is sourced from the JSON file. */
function conversionSettings(loaded: LoadedComputeConfig): InitSettingRow[] {
  const target = loaded.kind === "single" ? loaded.targets[0] : undefined;
  if (!target) {
    return [];
  }

  const source = COMPUTE_CONFIG_JSON_FILENAME;
  return [
    ...(target.name ? [{ key: "app", value: target.name, source }] : []),
    ...(target.framework
      ? [
          {
            key: "framework",
            value: frameworkByKey(target.framework).displayName,
            source,
          },
        ]
      : []),
    ...(target.entry ? [{ key: "entry", value: target.entry, source }] : []),
    ...(target.httpPort !== null
      ? [{ key: "http port", value: String(target.httpPort), source }]
      : []),
    ...(target.region ? [{ key: "region", value: target.region, source }] : []),
  ];
}

/**
 * App identity for the conversion result. Configs written by init pin all of
 * name, framework, and httpPort; hand-written configs that omit any of them
 * (or define multiple apps) report null instead of a partial identity.
 */
function conversionApp(loaded: LoadedComputeConfig): InitResult["app"] {
  const target = loaded.kind === "single" ? loaded.targets[0] : undefined;
  if (!target?.name || !target.framework || target.httpPort === null) {
    return null;
  }

  return {
    name: target.name,
    framework: target.framework,
    httpPort: target.httpPort,
    ...(target.entry ? { entry: target.entry } : {}),
    ...(target.region ? { region: target.region } : {}),
  };
}

function initConfigExistsError(existingPath: string): CliError {
  return new CliError({
    code: "INIT_CONFIG_EXISTS",
    domain: "app",
    summary: "A compute config already exists",
    why: `${existingPath} already defines this repository's compute config, and init never overwrites or merges.`,
    fix: "Edit the existing config instead, or delete it first if you want init to regenerate it.",
    exitCode: 1,
    nextSteps: [],
    meta: { existingConfigPath: existingPath },
  });
}

async function resolveInitFramework(
  context: CommandContext,
  flags: InitFlags,
  formatCommand: PrismaCliPackageCommandFormatter,
): Promise<ResolvedInitFramework> {
  if (flags.framework) {
    const framework = frameworkFromAlias(flags.framework.trim());
    if (!framework) {
      throw usageError(
        "Unknown framework",
        `"${flags.framework}" is not a supported framework.`,
        `Pass one of: ${FRAMEWORKS.map((candidate) => candidate.key).join(", ")}.`,
        [formatCommand(["init", "--framework", "hono"])],
        "app",
      );
    }
    return {
      key: framework.key,
      displayName: framework.displayName,
      source: "flag",
    };
  }

  const detected = await detectDeployFramework(
    context.runtime.cwd,
    context.runtime.signal,
  );
  if (detected) {
    return {
      key: detected.key as ComputeFramework,
      displayName: detected.displayName,
      source: detected.annotation,
    };
  }

  if (canPrompt(context) && !context.flags.yes) {
    const key = await selectPrompt<ComputeFramework>({
      input: context.runtime.stdin,
      output: context.output.stderr,
      signal: context.runtime.signal,
      message: "Which framework does this app use?",
      choices: FRAMEWORKS.map((framework) => ({
        label: framework.displayName,
        value: framework.key,
      })),
    });
    return {
      key,
      displayName: frameworkByKey(key).displayName,
      source: "selected",
    };
  }

  throw new CliError({
    code: "INIT_DETECTION_FAILED",
    domain: "app",
    summary: "No supported framework detected",
    why: "The directory has none of the framework signals init detects from, and no --framework was passed.",
    fix: `Pass --framework with one of: ${FRAMEWORKS.map((framework) => framework.key).join(", ")}.`,
    exitCode: 1,
    nextSteps: FRAMEWORKS.slice(0, 3).map((framework) =>
      formatCommand(["init", "--framework", framework.key]),
    ),
    meta: { frameworks: FRAMEWORKS.map((framework) => framework.key) },
  });
}

async function resolveInitAppName(
  cwd: string,
  explicitName: string | undefined,
  signal: AbortSignal,
  formatCommand: PrismaCliPackageCommandFormatter,
): Promise<{ value: string; source: string }> {
  const trimmed = explicitName?.trim();
  if (explicitName !== undefined && !trimmed) {
    throw usageError(
      "App name required",
      "--name needs a non-empty value.",
      "Pass a non-empty app name.",
      [formatCommand(["init", "--name", "api"])],
      "app",
    );
  }
  if (trimmed) {
    return { value: trimmed, source: "flag" };
  }

  const packageJson = await readBunPackageJson(cwd, signal);
  const packageName =
    typeof packageJson?.name === "string" ? packageJson.name.trim() : "";
  if (packageName) {
    return { value: packageName, source: "package.json" };
  }

  return { value: path.basename(cwd), source: "directory name" };
}

function parseInitHttpPort(
  value: string | undefined,
  formatCommand: PrismaCliPackageCommandFormatter,
): { value: number; source: string } | undefined {
  if (value === undefined) {
    return undefined;
  }

  const port = Number(value.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw usageError(
      "Invalid HTTP port",
      "--http-port must be an integer between 1 and 65535.",
      "Pass a valid port.",
      [formatCommand(["init", "--http-port", "3000"])],
      "app",
    );
  }

  return { value: port, source: "flag" };
}

function parseInitRegion(
  value: string | undefined,
  formatCommand: PrismaCliPackageCommandFormatter,
): ComputeRegion | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if ((COMPUTE_REGIONS as readonly string[]).includes(trimmed)) {
    return trimmed as ComputeRegion;
  }

  throw usageError(
    "Unknown region",
    `"${value}" is not a supported Compute region.`,
    `Pass one of: ${COMPUTE_REGIONS.join(", ")}.`,
    [formatCommand(["init", "--region", "us-east-1"])],
    "app",
  );
}

async function resolveInitEntry(
  cwd: string,
  resolvedFramework: ResolvedInitFramework,
  explicitEntry: string | undefined,
  signal: AbortSignal,
): Promise<{ value: string; source: string } | undefined> {
  const framework = frameworkByKey(resolvedFramework.key);
  const trimmed = explicitEntry?.trim();
  if (!framework.usesEntrypoint) {
    if (trimmed) {
      throw usageError(
        "--entry is not supported for this framework",
        `${resolvedFramework.displayName} derives its entrypoint from build output; --entry applies only to frameworks that run a source entrypoint (Bun, Hono).`,
        "Drop --entry, or pass an entrypoint framework with --framework.",
        [],
        "app",
      );
    }
    return undefined;
  }

  if (trimmed) {
    return { value: trimmed, source: "flag" };
  }

  const packageJson = await readBunPackageJson(cwd, signal);
  const packageEntrypoint = readBunPackageEntrypoint(packageJson);
  if (packageEntrypoint) {
    return { value: packageEntrypoint, source: "package.json" };
  }

  return undefined;
}

async function maybeAdjustSettings(
  context: CommandContext,
  framework: ResolvedInitFramework,
  httpPort: { value: number; source: string },
  options: { portExplicit: boolean },
): Promise<{
  framework: ResolvedInitFramework;
  httpPort: { value: number; source: string };
}> {
  if (!canPrompt(context) || context.flags.yes) {
    return { framework, httpPort };
  }

  const adjust = await confirmPrompt({
    input: context.runtime.stdin,
    output: context.output.stderr,
    signal: context.runtime.signal,
    message: `Adjust these settings? (${framework.displayName}, HTTP ${httpPort.value})`,
    initialValue: false,
  });
  if (!adjust) {
    return { framework, httpPort };
  }

  const key = await selectPrompt<ComputeFramework>({
    input: context.runtime.stdin,
    output: context.output.stderr,
    signal: context.runtime.signal,
    message: "Framework",
    choices: FRAMEWORKS.map((candidate) => ({
      label:
        candidate.key === framework.key
          ? `${candidate.displayName} (current)`
          : candidate.displayName,
      value: candidate.key,
    })),
  });
  const nextFramework: ResolvedInitFramework =
    key === framework.key
      ? framework
      : {
          key,
          displayName: frameworkByKey(key).displayName,
          source: "selected",
        };

  const defaultPort = options.portExplicit
    ? httpPort.value
    : defaultHttpPortForBuildType(frameworkByKey(key).buildType);
  const portText = await textPrompt({
    input: context.runtime.stdin,
    output: context.output.stderr,
    signal: context.runtime.signal,
    message: "HTTP port",
    placeholder: String(defaultPort),
    validate: (value) => {
      if (!value?.trim()) {
        return undefined;
      }
      const port = Number(value.trim());
      return Number.isInteger(port) && port >= 1 && port <= 65535
        ? undefined
        : "Enter a port between 1 and 65535.";
    },
  });
  const nextPort = portText.trim()
    ? { value: Number(portText.trim()), source: "selected" }
    : {
        value: defaultPort,
        source: options.portExplicit ? httpPort.source : "framework default",
      };

  return { framework: nextFramework, httpPort: nextPort };
}

function renderInitSettingsPreview(
  context: CommandContext,
  settings: InitSettingRow[],
): void {
  if (context.flags.quiet || context.flags.json) {
    return;
  }

  const keyWidth = Math.max(...settings.map((row) => row.key.length));
  const valueWidth = Math.max(...settings.map((row) => row.value.length));
  const lines = settings.map(
    (row) =>
      `  ${row.key.padEnd(keyWidth)}  ${row.value.padEnd(valueWidth)}  ${context.ui.dim(row.source)}`,
  );
  context.output.stderr.write(`${lines.join("\n")}\n\n`);
}

async function resolveInitLink(
  context: CommandContext,
  flags: InitFlags,
  hooks: {
    onWarning: (message: string) => void;
    formatCommand: PrismaCliPackageCommandFormatter;
  },
): Promise<InitLinkState> {
  const pin = await readLocalResolutionPin(
    context.runtime.cwd,
    context.runtime.signal,
  );
  if (pin.isOk() && pin.value.kind === "present") {
    return { status: "already-linked", project: null };
  }

  if (flags.link === false) {
    return { status: "skipped", project: null };
  }

  const explicitProject = flags.project?.trim();
  let shouldLink = Boolean(explicitProject) || flags.link === true;
  if (!shouldLink) {
    if (!canPrompt(context) || context.flags.yes) {
      return { status: "skipped", project: null };
    }
    try {
      shouldLink = await confirmPrompt({
        input: context.runtime.stdin,
        output: context.output.stderr,
        signal: context.runtime.signal,
        message: "Link this directory to a Prisma Project now?",
        initialValue: true,
      });
    } catch (error) {
      if (isPromptCancelError(error)) {
        return { status: "declined", project: null };
      }
      throw error;
    }
    if (!shouldLink) {
      return { status: "declined", project: null };
    }
  }

  try {
    const linked = await runProjectLink(context, explicitProject || undefined);
    return {
      status: "linked",
      project: {
        id: linked.result.project.id,
        name: linked.result.project.name,
      },
    };
  } catch (error) {
    if (error instanceof CliError) {
      if (isPromptCancelError(error)) {
        return { status: "declined", project: null };
      }
      // The config write already succeeded; a failed link must not undo it.
      hooks.onWarning(
        `Project link failed: ${error.summary}. Link later with ${hooks.formatCommand(["project", "link"])}.`,
      );
      return { status: "failed", project: null };
    }
    throw error;
  }
}

function formatInitDirectory(cwd: string): string {
  const basename = path.basename(cwd);
  return basename ? `./${basename}` : ".";
}
