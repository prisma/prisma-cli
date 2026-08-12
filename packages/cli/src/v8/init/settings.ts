/**
 * Resolving what init will write: format, framework, app name, port,
 * region and entrypoint, from flags, detection and prompts. The rules
 * are the legacy controller's (`src/controllers/init.ts`); what changed
 * is that interactivity is decided by the engine's prompt surface
 * instead of by the handler reading TTY state.
 */
import path from "node:path";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import {
  COMPUTE_CONFIG_JSON_FILENAME,
  COMPUTE_REGIONS,
  type ComputeFramework,
  type ComputeRegion,
  defaultHttpPortForBuildType,
  FRAMEWORKS,
  frameworkByKey,
  frameworkFromAlias,
} from "@prisma/compute-sdk/config";
import {
  readBunPackageEntrypoint,
  readBunPackageJson,
} from "../../lib/app/bun-project";
import { initError } from "./errors";
import type { InitConfigFormat, InitFlags, InitStepContext } from "./types";

export const COMPUTE_SDK_PACKAGE = "@prisma/compute-sdk";

export interface ResolvedFramework {
  readonly key: ComputeFramework;
  readonly displayName: string;
  readonly source: string;
}

export interface ResolvedValue<T> {
  readonly value: T;
  readonly source: string;
}

/** `--config-format ts` is only a conversion request when the user said it;
 *  the same value arrived at by default just writes TypeScript. */
export function parseFormat(value: "ts" | "json" | undefined): {
  readonly value: InitConfigFormat;
  readonly explicit: boolean;
} {
  if (value === undefined) {
    return { value: "typescript", explicit: false };
  }
  return value === "json"
    ? { value: "json", explicit: true }
    : { value: "typescript", explicit: true };
}

export function parseHttpPort(
  value: string | undefined,
  step: InitStepContext,
): ResolvedValue<number> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return { value: requirePort(value, step), source: "flag" };
}

function requirePort(value: string, step: InitStepContext): number {
  const port = Number(value.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw initError({
      code: "INIT.HTTP_PORT_INVALID",
      summary: "Invalid HTTP port",
      why: "--http-port must be an integer between 1 and 65535.",
      fix: "Pass a valid port.",
      commands: [step.formatCommand(["init", "--http-port", "3000"])],
    });
  }
  return port;
}

export function parseRegion(
  value: string | undefined,
  step: InitStepContext,
): ComputeRegion | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if ((COMPUTE_REGIONS as readonly string[]).includes(trimmed)) {
    return trimmed as ComputeRegion;
  }
  throw initError({
    code: "INIT.REGION_UNKNOWN",
    summary: "Unknown region",
    why: `"${value}" is not a supported Compute region.`,
    fix: `Pass one of: ${COMPUTE_REGIONS.join(", ")}.`,
    commands: [step.formatCommand(["init", "--region", "us-east-1"])],
  });
}

function detectionFailedError(step: InitStepContext): CliStructuredError {
  return initError({
    code: "INIT.DETECTION_FAILED",
    summary: "No supported framework detected",
    why: "The directory has none of the framework signals init detects from, and no --framework was passed.",
    fix: `Pass --framework with one of: ${FRAMEWORKS.map((framework) => framework.key).join(", ")}.`,
    commands: FRAMEWORKS.slice(0, 3).map((framework) =>
      step.formatCommand(["init", "--framework", framework.key]),
    ),
    meta: { frameworks: FRAMEWORKS.map((framework) => framework.key) },
  });
}

/**
 * The flag, then directory detection, then the user. The picker has no
 * default because nothing here is a defensible guess, so a run that
 * cannot prompt reaches the same dead end the legacy command did — the
 * engine's structural prompt failure is translated back into
 * INIT.DETECTION_FAILED, which names the frameworks to choose from.
 */
export async function resolveFramework(
  flags: InitFlags,
  step: InitStepContext,
): Promise<ResolvedFramework> {
  if (flags.framework) {
    const framework = frameworkFromAlias(flags.framework.trim());
    if (!framework) {
      throw initError({
        code: "INIT.FRAMEWORK_UNKNOWN",
        summary: "Unknown framework",
        why: `"${flags.framework}" is not a supported framework.`,
        fix: `Pass one of: ${FRAMEWORKS.map((candidate) => candidate.key).join(", ")}.`,
        commands: [step.formatCommand(["init", "--framework", "hono"])],
      });
    }
    return {
      key: framework.key,
      displayName: framework.displayName,
      source: "flag",
    };
  }

  const { detectDeployFramework } = await import(
    "../../lib/app/deploy-framework"
  );
  const detected = await detectDeployFramework(
    step.engine.cwd,
    step.engine.signal,
  );
  if (detected) {
    return {
      key: detected.key as ComputeFramework,
      displayName: detected.displayName,
      source: detected.annotation,
    };
  }

  let key: ComputeFramework;
  try {
    key = await step.engine.prompt.select<ComputeFramework>(
      "Which framework does this app use?",
      FRAMEWORKS.map((framework) => ({
        label: framework.displayName,
        value: framework.key,
      })),
    );
  } catch (error) {
    if (CliStructuredError.is(error) && error.code === "CLI.PROMPT_REQUIRED") {
      throw detectionFailedError(step);
    }
    throw error;
  }
  return {
    key,
    displayName: frameworkByKey(key).displayName,
    source: "selected",
  };
}

export async function resolveAppName(
  flags: InitFlags,
  step: InitStepContext,
): Promise<ResolvedValue<string>> {
  const trimmed = flags.name?.trim();
  if (flags.name !== undefined && !trimmed) {
    throw initError({
      code: "INIT.NAME_EMPTY",
      summary: "App name required",
      why: "--name needs a non-empty value.",
      fix: "Pass a non-empty app name.",
      commands: [step.formatCommand(["init", "--name", "api"])],
    });
  }
  if (trimmed) {
    return { value: trimmed, source: "flag" };
  }

  const packageJson = await readBunPackageJson(
    step.engine.cwd,
    step.engine.signal,
  );
  const packageName =
    typeof packageJson?.name === "string" ? packageJson.name.trim() : "";
  if (packageName) {
    return { value: packageName, source: "package.json" };
  }
  return { value: path.basename(step.engine.cwd), source: "directory name" };
}

/** Entry resolves against the FINAL framework, so an interactive
 *  framework switch cannot leave a stale entry in the written config. */
export async function resolveEntry(
  framework: ResolvedFramework,
  flags: InitFlags,
  step: InitStepContext,
): Promise<ResolvedValue<string> | undefined> {
  const descriptor = frameworkByKey(framework.key);
  const trimmed = flags.entry?.trim();
  if (!descriptor.usesEntrypoint) {
    if (trimmed) {
      throw initError({
        code: "INIT.ENTRY_UNSUPPORTED",
        summary: "--entry is not supported for this framework",
        why: `${framework.displayName} derives its entrypoint from build output; --entry applies only to frameworks that run a source entrypoint (Bun, Hono).`,
        fix: "Drop --entry, or pass an entrypoint framework with --framework.",
      });
    }
    return undefined;
  }
  if (trimmed) {
    return { value: trimmed, source: "flag" };
  }

  const packageEntrypoint = readBunPackageEntrypoint(
    await readBunPackageJson(step.engine.cwd, step.engine.signal),
  );
  return packageEntrypoint === undefined
    ? undefined
    : { value: packageEntrypoint, source: "package.json" };
}

/**
 * The one prompt that can change what gets written. Its default is no,
 * so `--yes` and non-interactive runs take the resolved settings
 * untouched — the legacy behavior.
 */
export async function maybeAdjustSettings(
  spec: {
    readonly framework: ResolvedFramework;
    readonly httpPort: ResolvedValue<number>;
    readonly portExplicit: boolean;
  },
  step: InitStepContext,
): Promise<{
  readonly framework: ResolvedFramework;
  readonly httpPort: ResolvedValue<number>;
}> {
  const prompt = step.engine.prompt;
  const adjust = await prompt.confirm(
    `Adjust these settings? (${spec.framework.displayName}, HTTP ${spec.httpPort.value})`,
    { default: false },
  );
  if (!adjust) {
    return { framework: spec.framework, httpPort: spec.httpPort };
  }

  const key = await prompt.select<ComputeFramework>(
    "Framework",
    FRAMEWORKS.map((candidate) => ({
      label:
        candidate.key === spec.framework.key
          ? `${candidate.displayName} (current)`
          : candidate.displayName,
      value: candidate.key,
    })),
    { default: spec.framework.key },
  );
  const framework: ResolvedFramework =
    key === spec.framework.key
      ? spec.framework
      : {
          key,
          displayName: frameworkByKey(key).displayName,
          source: "selected",
        };

  const defaultPort = spec.portExplicit
    ? spec.httpPort.value
    : defaultHttpPortForBuildType(frameworkByKey(key).buildType);
  const answer = (
    await prompt.text("HTTP port", {
      placeholder: String(defaultPort),
      default: String(defaultPort),
    })
  ).trim();

  return {
    framework,
    httpPort:
      answer === "" || Number(answer) === defaultPort
        ? {
            value: defaultPort,
            source: spec.portExplicit
              ? spec.httpPort.source
              : "framework default",
          }
        : { value: requirePort(answer, step), source: "selected" },
  };
}

export function installNotApplicableError(
  step: InitStepContext,
): CliStructuredError {
  return initError({
    code: "INIT.INSTALL_NOT_APPLICABLE",
    summary: "--install does not apply to the JSON config format",
    why: `${COMPUTE_CONFIG_JSON_FILENAME} is a dependency-free static config; the ${COMPUTE_SDK_PACKAGE} devDependency exists only for prisma.compute.ts editor types.`,
    fix: "Drop --install, or use the TypeScript format.",
    commands: [step.formatCommand(["init", "--config-format", "json"])],
  });
}

export function customFrameworkNeedsTypescriptError(
  step: InitStepContext,
): CliStructuredError {
  return initError({
    code: "INIT.CUSTOM_FRAMEWORK_NEEDS_TYPESCRIPT",
    summary: "Custom framework requires the TypeScript config format",
    why: "The custom framework needs build.outputDirectory and build.entrypoint, which init does not collect; the TypeScript format includes a commented build stub to complete, and strict JSON cannot carry it.",
    fix: `Rerun without --config-format json and fill in the build stub, or write ${COMPUTE_CONFIG_JSON_FILENAME} by hand with a build object.`,
    commands: [step.formatCommand(["init", "--framework", "custom"])],
  });
}
