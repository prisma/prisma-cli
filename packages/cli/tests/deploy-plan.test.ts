import { describe, expect, it } from "vitest";

import type { LoadedComputeConfig } from "../src/lib/app/compute-config";
import {
  describeDeployAllFailure,
  perAppInputsForDeployAll,
  planAppDeploy,
} from "../src/lib/app/deploy-plan";

function config(
  kind: "single" | "multi",
  keys: Array<string | null>,
): LoadedComputeConfig {
  return {
    configPath: "/repo/prisma.compute.ts",
    configDir: "/repo",
    relativeConfigPath: "prisma.compute.ts",
    kind,
    targets: keys.map((key) => ({
      key,
      name: null,
      region: null,
      root: key ? `apps/${key}` : null,
      framework: null,
      entry: null,
      httpPort: null,
      envInputs: [],
      build: null,
    })),
  };
}

const noPerAppInputs = {
  appName: undefined,
  framework: undefined,
  entrypoint: undefined,
  httpPort: undefined,
  region: undefined,
  envAssignments: undefined,
  appIdEnvVar: { name: "PRISMA_APP_ID", value: undefined },
};

describe("planAppDeploy", () => {
  it("deploys all targets for a multi-app config with no target named or inferred", () => {
    const plan = planAppDeploy({
      config: config("multi", ["api", "web"]),
      requestedTarget: undefined,
      hasCreateProject: false,
    });

    expect(plan).toEqual({
      mode: "all",
      targets: [
        { targetKey: "api", index: 0, total: 2, bindsCreateProject: false },
        { targetKey: "web", index: 1, total: 2, bindsCreateProject: false },
      ],
    });
  });

  it("binds --create-project to the first target only", () => {
    const plan = planAppDeploy({
      config: config("multi", ["api", "web"]),
      requestedTarget: undefined,
      hasCreateProject: true,
    });

    expect(
      plan.mode === "all" && plan.targets.map((t) => t.bindsCreateProject),
    ).toEqual([true, false]);
  });

  it("is a single deploy when a target is named or inferred", () => {
    expect(
      planAppDeploy({
        config: config("multi", ["api", "web"]),
        requestedTarget: "api",
        hasCreateProject: false,
      }),
    ).toEqual({ mode: "single" });
  });

  it("is a single deploy for single-app configs, one-target configs, and no config", () => {
    expect(
      planAppDeploy({
        config: config("single", [null]),
        requestedTarget: undefined,
        hasCreateProject: false,
      }),
    ).toEqual({ mode: "single" });
    expect(
      planAppDeploy({
        config: config("multi", ["only"]),
        requestedTarget: undefined,
        hasCreateProject: false,
      }),
    ).toEqual({ mode: "single" });
    expect(
      planAppDeploy({
        config: null,
        requestedTarget: undefined,
        hasCreateProject: false,
      }),
    ).toEqual({ mode: "single" });
  });
});

describe("perAppInputsForDeployAll", () => {
  it("is empty when no per-app inputs are present", () => {
    expect(perAppInputsForDeployAll(noPerAppInputs)).toEqual([]);
  });

  it("names every present per-app input, env var included, in report order", () => {
    expect(
      perAppInputsForDeployAll({
        appName: "api",
        framework: "hono",
        entrypoint: "src/index.ts",
        httpPort: "8080",
        region: "us-west-1",
        envAssignments: ["KEY=value"],
        appIdEnvVar: { name: "PRISMA_APP_ID", value: "app_1" },
      }),
    ).toEqual([
      "--app",
      "--framework",
      "--entry",
      "--http-port",
      "--region",
      "--env",
      "PRISMA_APP_ID",
    ]);
  });

  it("ignores an empty --env list", () => {
    expect(
      perAppInputsForDeployAll({ ...noPerAppInputs, envAssignments: [] }),
    ).toEqual([]);
  });
});

describe("describeDeployAllFailure", () => {
  it("reports the stop point, live targets, and unattempted targets", () => {
    const failure = describeDeployAllFailure({
      targetKeys: ["api", "web", "worker"],
      failedIndex: 1,
      completed: [{ target: "api", deploymentId: "dep_1", url: "https://api" }],
    });

    expect(failure.failedTarget).toBe("web");
    expect(failure.notAttempted).toEqual(["worker"]);
    expect(failure.contextLines).toEqual([
      'Deploying all apps stopped at "web" (2/3).',
      "Already live: api.",
      "Not attempted: worker.",
    ]);
  });

  it("omits the live and unattempted lines when there are none", () => {
    const failure = describeDeployAllFailure({
      targetKeys: ["api", "web"],
      failedIndex: 1,
      completed: [{ target: "api", deploymentId: "dep_1", url: "https://api" }],
    });

    expect(failure.notAttempted).toEqual([]);
    expect(failure.contextLines).toEqual([
      'Deploying all apps stopped at "web" (2/2).',
      "Already live: api.",
    ]);
  });
});
