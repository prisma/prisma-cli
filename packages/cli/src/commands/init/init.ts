/** `prisma init`: write a committed compute config for this app, then
 *  offer the steps that make it useful — editor types, a Project link,
 *  and the agent skill. */
import path from "node:path";
import { defineCommand, flag } from "@prisma/cli-engine";
import { type Diagnostic, ok } from "@prisma/cli-engine/protocol";
import {
  COMPUTE_CONFIG_JSON_FILENAME,
  COMPUTE_REGIONS,
  type ComputeConfig,
  defaultHttpPortForBuildType,
  FRAMEWORK_KEYS,
  frameworkByKey,
} from "@prisma/compute-sdk/config";
import { resolvePrismaCliPackageCommandFormatterSync } from "../../lib/agent/cli-command";
import { maybeOfferAgentSetup } from "./agent-setup";
import {
  configExistsError,
  convertJsonConfig,
  convertUnsupportedError,
  findExistingConfig,
  rejectConversionResolutionFlags,
  writeConfig,
} from "./config-file";
import { resolveLink } from "./link";
import { initPresentations, settingsPreview } from "./presentation";
import {
  customFrameworkNeedsTypescriptError,
  installNotApplicableError,
  maybeAdjustSettings,
  parseFormat,
  parseHttpPort,
  parseRegion,
  resolveAppName,
  resolveEntry,
  resolveFramework,
} from "./settings";
import type {
  InitFlags,
  InitLinkState,
  InitResult,
  InitSettingRow,
  InitStepContext,
  InitTypesState,
} from "./types";
import { resolveTypes, skippedTypes } from "./types-install";

function initDirectory(cwd: string): string {
  const basename = path.basename(cwd);
  return basename ? `./${basename}` : ".";
}

export const initCommand = defineCommand({
  help: {
    summary: "Write a committed compute config for this app",
    examples: [
      "init",
      "init --framework hono --entry src/index.ts",
      "init --name api --http-port 8080 --no-link",
      "init --config-format json",
    ],
  },
  args: {
    flags: {
      framework: flag.string({
        brief: `Framework override; detected when omitted (${FRAMEWORK_KEYS.join(", ")})`,
        placeholder: "framework",
      }),
      entry: flag.string({
        brief: "Source entrypoint for entrypoint frameworks",
        placeholder: "path",
      }),
      httpPort: flag.string({
        brief: "HTTP port the app listens on",
        placeholder: "port",
      }),
      region: flag.string({
        brief: `Region used when deploy creates the app (${COMPUTE_REGIONS.join(", ")})`,
        placeholder: "region",
      }),
      name: flag.string({ brief: "App name", placeholder: "app-name" }),
      link: flag.optionalBoolean({
        brief: "Link this directory to a Project, or skip the question",
      }),
      project: flag.string({
        brief: "Project to link to",
        placeholder: "id-or-name",
      }),
      install: flag.optionalBoolean({
        brief:
          "Install @prisma/compute-sdk as a dev dependency for config types",
      }),
      // NOT --format: the engine reserves that name for the output
      // format, and `--format json` there means a json envelope.
      configFormat: flag.enum({
        brief: "Config file format",
        values: ["ts", "json"],
      }),
    },
  },
  handler: async (args, ctx) => {
    const flags: InitFlags = args.flags;
    const diagnostics: Diagnostic[] = [];
    // User-facing command hints use the project's package runner (pnpm
    // dlx, bunx, npx -y), matching the agent group's convention.
    const formatCommand = resolvePrismaCliPackageCommandFormatterSync(ctx.cwd);
    const step: InitStepContext = {
      engine: ctx,
      formatCommand,
      record: (diagnostic) => diagnostics.push(diagnostic),
    };

    const format = parseFormat(flags.configFormat);
    if (format.value === "json" && flags.install === true) {
      throw installNotApplicableError(step);
    }

    const existing = await findExistingConfig(ctx.cwd, ctx.signal);
    const result = existing
      ? await runOverExistingConfig(existing, flags, format, step)
      : await runFresh(flags, format, step);

    return ok(
      ctx.present(
        { data: result, diagnostics },
        initPresentations(result, formatCommand),
      ),
    );
  },
});

type Format = ReturnType<typeof parseFormat>;

/** The same step, acting from the directory the config lives in. */
function at(step: InitStepContext, cwd: string): InitStepContext {
  if (path.resolve(step.engine.cwd) === path.resolve(cwd)) {
    return step;
  }
  return { ...step, engine: { ...step.engine, cwd } };
}

/**
 * Conversion must be explicit: only `--config-format ts` over a lone
 * prisma.compute.json converts. Plain init refuses every existing
 * config, and a TypeScript config never converts to JSON.
 */
async function runOverExistingConfig(
  existing: {
    readonly directory: string;
    readonly candidates: readonly string[];
  },
  flags: InitFlags,
  format: Format,
  step: InitStepContext,
): Promise<InitResult> {
  const solePath =
    existing.candidates.length === 1 ? existing.candidates[0] : undefined;
  const soleIsJson =
    solePath !== undefined && path.extname(solePath) === ".json";

  if (soleIsJson && format.value === "typescript" && format.explicit) {
    rejectConversionResolutionFlags(flags, step);
    return runConversion(solePath as string, flags, step);
  }
  if (solePath && !soleIsJson && format.value === "json") {
    throw convertUnsupportedError(solePath);
  }
  throw configExistsError(existing.candidates[0] ?? existing.directory);
}

async function runFresh(
  flags: InitFlags,
  format: Format,
  step: InitStepContext,
): Promise<InitResult> {
  const ctx = step.engine;
  const region = parseRegion(flags.region, step);
  const detected = await resolveFramework(flags, step);
  const name = await resolveAppName(flags, step);
  const resolvedPort = parseHttpPort(flags.httpPort, step) ?? {
    value: defaultHttpPortForBuildType(frameworkByKey(detected.key).buildType),
    source: "framework default",
  };
  const { framework, httpPort } = await maybeAdjustSettings(
    {
      framework: detected,
      httpPort: resolvedPort,
      portExplicit: flags.httpPort !== undefined,
    },
    step,
  );

  // The custom framework needs build.outputDirectory and
  // build.entrypoint, which init does not collect. The TypeScript format
  // carries a commented build stub to fill in; strict JSON cannot hold
  // comments, so refuse here instead of writing a config deploy rejects.
  if (format.value === "json" && framework.key === "custom") {
    throw customFrameworkNeedsTypescriptError(step);
  }

  const entry = await resolveEntry(framework, flags, step);
  const app = {
    name: name.value,
    framework: framework.key,
    httpPort: httpPort.value,
    ...(entry ? { entry: entry.value } : {}),
    ...(region ? { region } : {}),
  };
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
  reportSettings(step, settings);

  ctx.report({ kind: "step-started", step: "write-config" });
  const written = await writeConfig({
    cwd: ctx.cwd,
    config: { app } as ComputeConfig,
    format: format.value,
    custom: framework.key === "custom",
    signal: ctx.signal,
  });
  ctx.report({
    kind: "step-finished",
    step: "write-config",
    outcome: "ok",
    data: { path: written.filename },
  });

  // The JSON format exists to be dependency-free, so the types install
  // step never runs for it; validation happens when commands load the
  // config.
  const types =
    format.value === "json" ? skippedTypes() : await runTypes(step, flags);
  const link = await runLink(step, flags);
  await runAgentSetup(step);

  return {
    configPath: written.filename,
    format: format.value,
    converted: false,
    directory: initDirectory(ctx.cwd),
    app,
    settings,
    types,
    link,
  };
}

/**
 * Conversion transports the config's values but its side-effect steps
 * behave exactly like fresh init, and they act on the config's home, not
 * the invocation directory: discovery may have found the config in an
 * ancestor, and the types dependency and project pin belong where the
 * config lives.
 */
async function runConversion(
  jsonConfigPath: string,
  flags: InitFlags,
  step: InitStepContext,
): Promise<InitResult> {
  const ctx = step.engine;
  ctx.report({ kind: "step-started", step: "convert-config" });
  const converted = await convertJsonConfig(jsonConfigPath, ctx.signal);
  ctx.report({
    kind: "step-finished",
    step: "convert-config",
    outcome: "ok",
    data: { from: COMPUTE_CONFIG_JSON_FILENAME, to: converted.tsConfigPath },
  });
  reportSettings(step, converted.settings);

  const atConfigDir = at(step, converted.configDir);
  const types = await runTypes(atConfigDir, flags);
  const link = await runLink(atConfigDir, flags);
  await runAgentSetup(atConfigDir);

  return {
    configPath:
      path.relative(ctx.cwd, converted.tsConfigPath) || "prisma.compute.ts",
    format: "typescript",
    converted: true,
    directory: initDirectory(converted.configDir),
    app: converted.app,
    settings: converted.settings,
    types,
    link,
  };
}

/** The legacy stderr preview of what init is about to write. */
function reportSettings(
  step: InitStepContext,
  settings: readonly InitSettingRow[],
): void {
  const preview = settingsPreview(settings);
  if (preview !== null) {
    step.engine.report(preview);
  }
}

function outcomeOf(
  status: InitTypesState["status"] | InitLinkState["status"],
): "ok" | "warning" | "skipped" {
  if (status === "failed") {
    return "warning";
  }
  return status === "skipped" || status === "declined" ? "skipped" : "ok";
}

async function runTypes(
  step: InitStepContext,
  flags: InitFlags,
): Promise<InitTypesState> {
  step.engine.report({ kind: "step-started", step: "install-types" });
  const types = await resolveTypes(flags, step);
  step.engine.report({
    kind: "step-finished",
    step: "install-types",
    outcome: outcomeOf(types.status),
    data: { status: types.status },
  });
  return types;
}

async function runLink(
  step: InitStepContext,
  flags: InitFlags,
): Promise<InitLinkState> {
  step.engine.report({ kind: "step-started", step: "link-project" });
  const link = await resolveLink(flags, step);
  step.engine.report({
    kind: "step-finished",
    step: "link-project",
    outcome:
      link.status === "unauthenticated" ? "warning" : outcomeOf(link.status),
    data: { status: link.status },
  });
  return link;
}

async function runAgentSetup(step: InitStepContext): Promise<void> {
  step.engine.report({ kind: "step-started", step: "agent-setup" });
  await maybeOfferAgentSetup(step);
  step.engine.report({
    kind: "step-finished",
    step: "agent-setup",
    outcome: "ok",
  });
}
