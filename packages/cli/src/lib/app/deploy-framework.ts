import path from "node:path";
import type { FrameworkBuildType } from "@prisma/compute-sdk/config";
import { detectComputeAppFromDirectory } from "@prisma/compute-sdk/config/directory";

export interface ResolvedDeployFramework {
  key: string;
  buildType: FrameworkBuildType;
  displayName: string;
  annotation: string;
}

/** Reads the directory's package.json and framework config to name the
 *  framework a deploy would use, or null when none is recognised. */
export async function detectDeployFramework(
  cwd: string,
  signal: AbortSignal,
): Promise<ResolvedDeployFramework | null> {
  const detected = await detectComputeAppFromDirectory({
    appPath: cwd,
    signal,
  });
  if (!detected) return null;

  let annotation = "detected from package.json";
  if (detected.configFile?.standaloneOutput) {
    annotation = "standalone output detected";
  } else if (detected.configFile) {
    annotation = `detected from ${path.basename(detected.configFile.path)}`;
  }

  return {
    key: detected.framework,
    buildType: detected.buildType,
    displayName: detected.frameworkName,
    annotation,
  };
}
