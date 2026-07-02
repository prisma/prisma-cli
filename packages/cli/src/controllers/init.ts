import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  COMPUTE_CONFIG_FILENAME,
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
  serializeComputeConfig,
} from "@prisma/compute-sdk/config";

import {
  type PrismaCliPackageCommandFormatter,
  resolvePrismaCliPackageCommandFormatterSync,
} from "../lib/agent/cli-command";
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
import type { InitLinkState, InitResult, InitSettingRow } from "../types/init";
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

  await requireNoExistingComputeConfig(cwd, signal);

  const region = parseInitRegion(flags.region, formatCommand);
  let framework = await resolveInitFramework(context, flags, formatCommand);
  const name = await resolveInitAppName(cwd, flags.name, signal, formatCommand);
  let httpPort = parseInitHttpPort(flags.httpPort, formatCommand) ?? {
    value: defaultHttpPortForBuildType(frameworkByKey(framework.key).buildType),
    source: "framework default",
  };
  const entry = await resolveInitEntry(cwd, framework.key, flags.entry, signal);

  const adjusted = await maybeAdjustSettings(context, framework, httpPort, {
    portExplicit: flags.httpPort !== undefined,
  });
  framework = adjusted.framework;
  httpPort = adjusted.httpPort;

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

  const configPath = path.join(cwd, COMPUTE_CONFIG_FILENAME);
  let source = serializeComputeConfig(config);
  if (framework.key === "custom") {
    source += CUSTOM_BUILD_STUB;
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
  const link = await resolveInitLink(context, flags, {
    onWarning: (message) => warnings.push(message),
    formatCommand,
  });

  const unlinked = link.status !== "linked" && link.status !== "already-linked";
  return {
    command: "init",
    result: {
      configPath: COMPUTE_CONFIG_FILENAME,
      directory: formatInitDirectory(cwd),
      app: {
        name: name.value,
        framework: framework.key,
        httpPort: httpPort.value,
        ...(entry ? { entry: entry.value } : {}),
        ...(region ? { region } : {}),
      },
      settings,
      link,
    },
    warnings,
    nextSteps: [
      formatCommand(["app", "deploy"]),
      ...(unlinked ? [formatCommand(["project", "link"])] : []),
    ],
  };
}

const CUSTOM_BUILD_STUB = `
// framework "custom" deploys a prebuilt artifact. Add its build settings:
// build: {
//   command: "npm run build",
//   outputDirectory: "dist",
//   entrypoint: "server.js",
// },
`;

async function requireNoExistingComputeConfig(
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  const configDir = await findComputeConfigDir(cwd, signal);
  if (!configDir) {
    return;
  }

  const candidates = await findComputeConfigCandidates(configDir, signal);
  throw initConfigExistsError(candidates[0] ?? configDir);
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
  frameworkKey: ComputeFramework,
  explicitEntry: string | undefined,
  signal: AbortSignal,
): Promise<{ value: string; source: string } | undefined> {
  const framework = frameworkByKey(frameworkKey);
  if (!framework.usesEntrypoint) {
    return undefined;
  }

  const trimmed = explicitEntry?.trim();
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
