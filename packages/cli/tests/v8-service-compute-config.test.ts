/**
 * The compute-config path that every service command shares. `service
 * show` drives it here on behalf of all of them: the config load, the
 * `[service]` positional and the config-named service are decided by
 * `resolveComputeManagementContext`, which `resolveServiceReadState` and
 * `resolveServiceDomainTarget` call with the same arguments, so one
 * command proves the code the others run.
 *
 * The same runs pin the two pieces of error plumbing this path reaches:
 * `fromLegacyCliError`, which maps a legacy CliError onto the engine's
 * structured shape, and `renameAppCopy`, which keeps the `app` noun out
 * of ported copy. The rename's other surface, the domain failure
 * guidance, is pinned in v8-service-domain-wait.test.ts.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { StreamEvent } from "@prisma/cli-engine";
import { describe, expect, it } from "vitest";

import {
  DEPLOYMENTS,
  makeServiceCli,
  page,
  type RawService,
  type Routes,
  readFlowRoutes,
  SERVICE,
  SERVICE_DETAIL,
} from "./v8-service-testkit";

const OTHER_SERVICE: RawService = {
  ...SERVICE,
  id: "svc_2",
  name: "api",
  latestDeploymentId: null,
  appEndpointDomain: null,
};

/** Two services, so a run that reaches the picker cannot settle without
 *  a scripted answer. */
function twoServiceRoutes(): Routes {
  return readFlowRoutes({
    "GET /v1/apps": () => ({ data: page([SERVICE, OTHER_SERVICE]) }),
    "GET /v1/apps/{appId}": (init) =>
      init.params?.path?.appId === OTHER_SERVICE.id
        ? {
            data: {
              data: {
                id: OTHER_SERVICE.id,
                name: OTHER_SERVICE.name,
                projectId: "proj_1",
                region: { id: null },
                latestDeploymentId: null,
                appEndpointDomain: null,
              },
            },
          }
        : { data: { data: SERVICE_DETAIL } },
    "GET /v1/apps/{appId}/deployments": (init) =>
      init.params?.path?.appId === OTHER_SERVICE.id
        ? { data: page([]) }
        : { data: page(DEPLOYMENTS) },
  });
}

async function writeComputeConfig(
  cwd: string,
  apps: Record<string, Record<string, unknown>>,
): Promise<void> {
  await writeFile(
    path.join(cwd, "prisma.compute.json"),
    JSON.stringify({ apps }),
  );
}

function settledError(result: { readonly json: readonly StreamEvent[] }) {
  const frame = result.json[result.json.length - 1];
  if (frame?.kind !== "result" || frame.envelope.ok) {
    throw new Error("expected an errored envelope");
  }
  return frame.envelope.error;
}

describe("prisma-v8 service — the compute config", () => {
  it("maps an unknown target through the legacy error mapper, in service prose", async () => {
    const harness = await makeServiceCli();
    await writeComputeConfig(harness.cwd, {
      web: { framework: "nextjs" },
      api: { framework: "hono" },
    });

    const result = await harness.cli.run(
      ["service", "show", "nope", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const error = settledError(result);
    expect(error.code).toBe("SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN");
    expect(error.summary).toBe('Unknown service target "nope"');
    // The legacy `fix` survives as advice, ahead of a run-command per
    // configured target built from the legacy nextSteps.
    expect(error.nextActions).toEqual([
      {
        kind: "user-choice",
        label: "Pass one of the configured targets: web, api.",
      },
      {
        kind: "run-command",
        label: "Run",
        command: "prisma-cli service show web",
      },
      {
        kind: "run-command",
        label: "Run",
        command: "prisma-cli service show api",
      },
    ]);
    expect(error.meta).toMatchObject({
      requestedTarget: "nope",
      availableTargets: ["web", "api"],
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("app target");
    expect(serialized).not.toContain("prisma-cli app ");
  });

  it("rejects a named target when the directory has no compute config", async () => {
    const harness = await makeServiceCli();

    const result = await harness.cli.run(
      ["service", "show", "web", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const error = settledError(result);
    expect(error.code).toBe("SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN");
    expect(error.summary).toBe(
      'Service target "web" requires a compute config file',
    );
  });

  it("selects the service the config target names, without a picker", async () => {
    const harness = await makeServiceCli({ routes: twoServiceRoutes() });
    await writeComputeConfig(harness.cwd, {
      web: { framework: "nextjs", name: SERVICE.name },
      api: { framework: "hono" },
    });

    // No scripted answers: reaching the picker would fail this run.
    const result = await harness.cli.run(
      ["service", "show", "web", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      service: { id: SERVICE.id, name: SERVICE.name },
    });
  });

  it("prefers the service the config names over the remembered selection", async () => {
    const harness = await makeServiceCli({ routes: twoServiceRoutes() });
    await writeComputeConfig(harness.cwd, {
      web: { framework: "nextjs", name: SERVICE.name },
      api: { framework: "hono" },
    });

    const remembering = await harness.cli.run(
      ["service", "show", "--project", "acme-app", "--service", "api"],
      { cwd: harness.cwd, env: harness.env },
    );
    expect(remembering.exitCode).toBe(0);
    expect(remembering.presented?.data).toMatchObject({
      service: { id: OTHER_SERVICE.id },
    });

    const result = await harness.cli.run(
      ["service", "show", "web", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      service: { id: SERVICE.id, name: SERVICE.name },
    });
  });

  it("settles an unusable config file through the mapper, naming the file", async () => {
    const harness = await makeServiceCli();
    await writeComputeConfig(harness.cwd, { web: { framework: "cobol" } });

    const result = await harness.cli.run(
      ["service", "show", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const error = settledError(result);
    expect(error.code).toBe("SERVICE.COMPUTE_CONFIG_INVALID");
    expect(error.summary).toBe("Invalid prisma.compute.json");
    expect(error.where?.path).toBe(
      path.join(harness.cwd, "prisma.compute.json"),
    );
    // The config's own keys are the SDK's, so the rename leaves the
    // `app` in `defineComputeConfig({ app })` alone.
    expect(error.nextActions).toEqual([
      {
        kind: "user-choice",
        label:
          "Edit prisma.compute.json so it default-exports defineComputeConfig({ app }) or defineComputeConfig({ apps }).",
      },
      {
        kind: "run-command",
        label: "Run",
        command: "prisma-cli service show",
      },
    ]);
    expect(JSON.stringify(error)).not.toContain("prisma-cli app ");
  });
});
