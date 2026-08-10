import { access } from "node:fs/promises";
import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  ENTRYPOINT_BUILD_TYPES,
  FRAMEWORKS,
  isConfigBackedBuildType,
} from "@prisma/compute-sdk/config";
import { detectComputeAppFromDirectory } from "@prisma/compute-sdk/config/directory";
import {
  APP_BUILD_TYPES,
  type AppBuildSettings,
  type AppBuildType,
  executeAppBuild,
  RESOLVED_APP_BUILD_TYPES,
  resolveConfiguredAppBuildSettings,
} from "../../lib/app/build";
import { mergeComputeLocalInputs } from "../../lib/app/compute-config";
import {
  buildDetectionAmbiguousError,
  buildFailedError,
  buildSettingsUnsupportedError,
  computeConfigInvalidError,
  entrypointUnsupportedError,
  frameworkNotDetectedError,
} from "./errors";
import { buildPresentations } from "./presentation";
import type { ServiceContext } from "./target";
import { computeTargetDirectory, resolveComputeTarget } from "./target";

function formatBuildTypeName(buildType: AppBuildType): string {
  if (buildType === "auto") {
    return "Auto";
  }
  for (let index = FRAMEWORKS.length - 1; index >= 0; index -= 1) {
    const framework = FRAMEWORKS[index];
    if (framework?.buildType === buildType) {
      return framework.displayName;
    }
  }
  return buildType;
}

function isAutoBuildDetectionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("Entrypoint is required.")
  );
}

async function requireTargetDirectory(
  ctx: ServiceContext,
  compute: Parameters<typeof computeTargetDirectory>[1],
): Promise<string> {
  const appDir = computeTargetDirectory(ctx, compute);
  if (!compute.config || !compute.target?.root) {
    return appDir;
  }

  ctx.signal.throwIfAborted();
  try {
    // access does not accept AbortSignal; check before and after the boundary.
    await access(appDir);
    ctx.signal.throwIfAborted();
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    throw computeConfigInvalidError({
      summary: `Service root "${compute.target.root}" does not exist`,
      why: `${compute.config.relativeConfigPath} points the selected service at "${compute.target.root}", but that directory does not exist.`,
      where: appDir,
      meta: { serviceRoot: compute.target.root, serviceDir: appDir },
      advice: `Fix the root path in ${compute.config.relativeConfigPath} or create the directory.`,
    });
  }
  return appDir;
}

export const serviceBuildCommand = defineCommand({
  help: {
    summary: "Build the service locally into a deployable artifact",
    examples: [
      "service build",
      "service build --build-type nextjs",
      "service build --build-type bun --entry server.ts",
    ],
  },
  args: {
    flags: {
      entry: flag.string({
        brief: "Entrypoint path for Bun or auto builds",
        placeholder: "path",
      }),
      buildType: flag.enum({
        brief: "Local build type",
        values: [...APP_BUILD_TYPES],
        default: "auto",
      }),
    },
    positionals: {
      service: positional.optionalString({
        brief:
          "Service target from prisma.compute.ts when the config defines multiple services",
        placeholder: "service",
      }),
    },
  },
  handler: async (args, ctx) => {
    const compute = await resolveComputeTarget(
      ctx,
      args.positionals.service,
      "build",
    );
    const merged = mergeComputeLocalInputs({
      cli: {
        entrypoint: args.flags.entry,
        buildType: args.flags.buildType,
      },
      target: compute.target,
    });
    const appDir = await requireTargetDirectory(ctx, compute);

    let buildType = (merged.buildType ?? "auto") as AppBuildType;
    if (compute.target?.build && buildType === "auto") {
      // A committed build block must never be silently ignored, so the
      // framework resolves the same way deploy does instead of deferring
      // to the strategy's auto detection.
      const detected = await detectComputeAppFromDirectory({
        appPath: appDir,
        signal: ctx.signal,
      });
      if (!detected) {
        throw frameworkNotDetectedError(appDir);
      }
      buildType = detected.buildType;
    }

    if (
      buildType !== "auto" &&
      !(ENTRYPOINT_BUILD_TYPES as readonly string[]).includes(buildType) &&
      merged.entrypoint
    ) {
      throw entrypointUnsupportedError(buildType);
    }

    let buildSettings: AppBuildSettings | undefined;
    if (compute.config && compute.target?.build && buildType !== "auto") {
      if (!isConfigBackedBuildType(buildType)) {
        throw buildSettingsUnsupportedError(
          formatBuildTypeName(buildType),
          buildType,
        );
      }
      buildSettings = (
        await resolveConfiguredAppBuildSettings({
          appPath: appDir,
          buildType,
          configured: compute.target.build,
          configPath: compute.config.configPath,
          signal: ctx.signal,
        })
      ).settings;
    }

    ctx.report({ kind: "step-started", step: "build" });
    try {
      const { artifact, buildType: actualBuildType } = await executeAppBuild({
        appPath: appDir,
        entrypoint: merged.entrypoint,
        buildType,
        buildSettings,
        signal: ctx.signal,
        io: {
          onOutput: (line, source) => {
            ctx.report({
              kind: "output",
              source: "build",
              channel: source === "stdout" ? "data" : "diagnostic",
              line,
            });
          },
        },
      });
      ctx.report({ kind: "step-finished", step: "build", outcome: "ok" });
      ctx.report({
        kind: "artifact",
        path: artifact.directory,
        description: "deployable service artifact",
      });

      const result = {
        directory: artifact.directory,
        entrypoint: artifact.entrypoint,
        buildType: actualBuildType,
      };
      return ok(ctx.present({ data: result }, buildPresentations(result)));
    } catch (error) {
      ctx.report({ kind: "step-finished", step: "build", outcome: "failed" });
      if (buildType === "auto" && isAutoBuildDetectionError(error)) {
        throw buildDetectionAmbiguousError(
          RESOLVED_APP_BUILD_TYPES.map(formatBuildTypeName),
        );
      }
      throw buildFailedError("Local service build failed", error);
    }
  },
});
