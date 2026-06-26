import type { LoadedComputeConfig } from "./compute-config";

/**
 * Deploy planning for `app deploy`: the pure decisions about which compute
 * targets a run covers and how a deploy-all run is validated and reported.
 * Kept free of I/O and CliError so the controller owns presentation and the
 * planning stays unit-testable in isolation.
 */

/** One compute target scheduled in a deploy-all run, in declaration order. */
export interface PlannedDeployTarget {
  /** The `apps` key identifying this target. */
  targetKey: string;
  /** Zero-based position in the run. */
  index: number;
  /** Total targets in the run. */
  total: number;
  /**
   * Whether this target binds `--create-project`. Only the first target does;
   * the rest resolve the Project through the local pin it writes, so the
   * Project (and its `--db` branch database) is created once per run.
   */
  bindsCreateProject: boolean;
}

export type AppDeployPlan =
  | { mode: "single" }
  | { mode: "all"; targets: PlannedDeployTarget[] };

/**
 * Decides whether a deploy covers one app or the whole system. A multi-app
 * config with no target named or inferred deploys every target in declaration
 * order; everything else (single-app config, an explicit/inferred target, or
 * no config at all) is a single deploy.
 */
export function planAppDeploy(options: {
  config: LoadedComputeConfig | null;
  requestedTarget: string | undefined;
  hasCreateProject: boolean;
}): AppDeployPlan {
  const { config, requestedTarget, hasCreateProject } = options;

  const isDeployAll =
    config !== null &&
    config.kind === "multi" &&
    !requestedTarget &&
    config.targets.length > 1;
  if (!isDeployAll) {
    return { mode: "single" };
  }

  const total = config.targets.length;
  return {
    mode: "all",
    targets: config.targets.map((target, index) => ({
      targetKey: target.key as string,
      index,
      total,
      bindsCreateProject: index === 0 && hasCreateProject,
    })),
  };
}

/** Per-app inputs that only make sense when a single target is selected. */
export interface DeployAllPerAppInputs {
  appName: string | undefined;
  framework: string | undefined;
  entrypoint: string | undefined;
  httpPort: string | undefined;
  region: string | undefined;
  envAssignments: string[] | undefined;
  /** App-id environment override, passed with its variable name for the message. */
  appIdEnvVar: { name: string; value: string | undefined };
}

/**
 * Names the per-app inputs present in a deploy-all invocation, in the order
 * they should be reported. An empty list means the run is unambiguous; the
 * caller renders the usage error when it is not.
 */
export function perAppInputsForDeployAll(
  inputs: DeployAllPerAppInputs,
): string[] {
  const candidates: Array<[string, unknown]> = [
    ["--app", inputs.appName],
    ["--framework", inputs.framework],
    ["--entry", inputs.entrypoint],
    ["--http-port", inputs.httpPort],
    ["--region", inputs.region],
    [
      "--env",
      inputs.envAssignments?.length ? inputs.envAssignments : undefined,
    ],
    [inputs.appIdEnvVar.name, inputs.appIdEnvVar.value],
  ];

  return candidates
    .filter(([, value]) => value !== undefined)
    .map(([flag]) => flag);
}

/** A target that deployed before a later target in the run failed. */
export interface CompletedDeployTarget {
  target: string;
  deploymentId: string;
  url: string | null;
}

export interface DeployAllFailure {
  failedTarget: string;
  completed: CompletedDeployTarget[];
  notAttempted: string[];
  /** Human-readable lines describing where the run stopped. */
  contextLines: string[];
}

/**
 * Describes a deploy-all run that stopped at the first failing target: which
 * targets already went live and which were never attempted, so the caller can
 * surface a converge path. Pure; the caller folds this into the CliError.
 */
export function describeDeployAllFailure(options: {
  targetKeys: string[];
  failedIndex: number;
  completed: CompletedDeployTarget[];
}): DeployAllFailure {
  const { targetKeys, failedIndex, completed } = options;
  const failedTarget = targetKeys[failedIndex] as string;
  const notAttempted = targetKeys.slice(failedIndex + 1);

  const contextLines = [
    `Deploying all apps stopped at "${failedTarget}" (${failedIndex + 1}/${targetKeys.length}).`,
    ...(completed.length > 0
      ? [`Already live: ${completed.map((entry) => entry.target).join(", ")}.`]
      : []),
    ...(notAttempted.length > 0
      ? [`Not attempted: ${notAttempted.join(", ")}.`]
      : []),
  ];

  return { failedTarget, completed, notAttempted, contextLines };
}
