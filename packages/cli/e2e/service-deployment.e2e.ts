/**
 * The deployment verbs, against a service this file deploys to.
 *
 * Every command here needs a deployment to act on, which is why they
 * had no coverage: the CLI cannot make one, and only Composer does.
 * `deployed-service.ts` does what Composer does through the management
 * API, so these commands can finally be run rather than reasoned about.
 *
 * The blocks run in file order and share one service: it is deployed
 * once, read by the middle blocks, then stopped and deleted at the end.
 * The rollback block adds a second deployment, promotes it, and rolls
 * back to the first, so the later blocks still act on a live first
 * deployment. Teardown must delete every deployment before the scratch
 * project can go.
 */
import { afterAll, expect, it } from "vitest";

import {
  createDeployment,
  deleteDeployment,
  deployService,
} from "./deployed-service";
import type { CliRun } from "./harness";
import { scratchName } from "./harness";
import { useScratchProject } from "./scratch";
import { describeCommand } from "./suite";

const HTTPS_URL = /^https:\/\//;

const scratch = useScratchProject("service-deployment");

let deployed:
  | { serviceId: string; serviceName: string; deploymentId: string }
  | undefined;

let secondDeployment: { id: string; serviceName: string } | undefined;

function requireDeployed(): {
  serviceId: string;
  serviceName: string;
  deploymentId: string;
} {
  if (deployed === undefined) {
    throw new Error("the deployment fixture did not run");
  }
  return deployed;
}

interface DeploymentRow {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly url: string | null;
  readonly live: boolean | null;
}

afterAll(async () => {
  if (secondDeployment !== undefined) {
    await deleteDeployment(scratch, secondDeployment);
  }
  if (deployed !== undefined) {
    await deleteDeployment(scratch, {
      id: deployed.deploymentId,
      serviceName: deployed.serviceName,
    });
  }
});

describeCommand("service deployment promote", () => {
  it("deploys a service and promotes the deployment live", async () => {
    // `deployService` runs `service deployment start` and then
    // `service deployment promote`; both are commands under test, so a
    // failure in either fails here rather than somewhere downstream.
    deployed = await deployService(scratch, scratchName("dep"));

    const run = await scratch.run([
      "service",
      "deployment",
      "show",
      deployed.deploymentId,
    ]);
    const shown = run.envelope.result as { deployment: DeploymentRow };

    expect(shown.deployment.id).toBe(deployed.deploymentId);
    expect(shown.deployment.live).toBe(true);
    expect(shown.deployment.status).toBe("running");
  });
});

describeCommand("service deployment start", () => {
  it("reports the deployment the fixture started as running", async () => {
    const existing = requireDeployed();
    // Starting an already-running deployment is the idempotent answer,
    // which is the only start this file can make twice.
    const run = await scratch.run([
      "service",
      "deployment",
      "start",
      existing.deploymentId,
      "--service",
      existing.serviceName,
    ]);
    const started = run.envelope.result as {
      readonly deployment: DeploymentRow;
      readonly alreadyInState: boolean;
    };

    expect(started.deployment.id).toBe(existing.deploymentId);
    expect(started.deployment.status).toBe("running");
    expect(started.alreadyInState).toBe(true);
  });
});

describeCommand("service deployment list", () => {
  it("lists the deployment, and marks it live", async () => {
    const existing = requireDeployed();
    const run = await scratch.run([
      "service",
      "deployment",
      "list",
      "--service",
      existing.serviceName,
    ]);
    const listed = run.envelope.result as {
      readonly projectId: string;
      readonly service: { readonly id: string };
      readonly deployments: readonly DeploymentRow[];
    };

    expect(listed.projectId).toBe(scratch.project().id);
    expect(listed.service.id).toBe(existing.serviceId);
    const found = listed.deployments.find(
      (deployment) => deployment.id === existing.deploymentId,
    );
    expect(found?.live).toBe(true);
    expect(found?.url).toBeTruthy();
  });
});

describeCommand("service deployment show", () => {
  it("shows the deployment and the service it belongs to", async () => {
    const existing = requireDeployed();
    const run = await scratch.run([
      "service",
      "deployment",
      "show",
      existing.deploymentId,
    ]);
    const shown = run.envelope.result as {
      readonly service: { readonly id: string; readonly name: string };
      readonly deployment: DeploymentRow;
    };

    expect(shown.service.id).toBe(existing.serviceId);
    expect(shown.service.name).toBe(existing.serviceName);
    expect(shown.deployment.id).toBe(existing.deploymentId);
    expect(Date.parse(shown.deployment.createdAt)).not.toBeNaN();
  });
});

describeCommand("service deployment rollback", () => {
  it("rolls production back to the previously live deployment", async () => {
    const existing = requireDeployed();
    // Rolling back needs somewhere to roll back from: a second
    // deployment, promoted over the first. It is tracked for teardown
    // before anything can throw, because `project remove` refuses while
    // it exists.
    const secondId = await createDeployment(existing.serviceId);
    secondDeployment = { id: secondId, serviceName: existing.serviceName };
    await scratch.run([
      "service",
      "deployment",
      "start",
      secondId,
      "--service",
      existing.serviceName,
    ]);
    await scratch.run([
      "service",
      "deployment",
      "promote",
      secondId,
      "--service",
      existing.serviceName,
    ]);

    // No --to: the default target is the deployment before the live
    // one, which is the first. --confirm must name that target.
    const run = await scratch.run([
      "service",
      "deployment",
      "rollback",
      "--service",
      existing.serviceName,
      "--confirm",
      existing.deploymentId,
    ]);
    const rolledBack = run.envelope.result as {
      readonly service: { readonly id: string };
      readonly deployment: DeploymentRow;
      readonly previousLiveDeploymentId: string | null;
    };

    expect(rolledBack.service.id).toBe(existing.serviceId);
    expect(rolledBack.deployment.id).toBe(existing.deploymentId);
    expect(rolledBack.deployment.live).toBe(true);
    expect(rolledBack.previousLiveDeploymentId).toBe(secondId);

    const shown = await scratch.run([
      "service",
      "deployment",
      "show",
      existing.deploymentId,
    ]);
    const after = shown.envelope.result as { deployment: DeploymentRow };
    expect(after.deployment.live).toBe(true);
  });
});

describeCommand("service open", () => {
  it("answers with the service's URL rather than opening one", async () => {
    const existing = requireDeployed();
    // No browser and no TTY in CI, so the command reports the URL it
    // would have opened. That it declined to open is part of the
    // contract, not an incidental detail.
    const run = await scratch.run([
      "service",
      "open",
      "--service",
      existing.serviceName,
    ]);
    const opened = run.envelope.result as {
      readonly service: { readonly id: string };
      readonly url: string;
      readonly opened: boolean;
    };

    expect(opened.service.id).toBe(existing.serviceId);
    expect(opened.url).toMatch(HTTPS_URL);
    expect(opened.opened).toBe(false);
  });
});

/** The log lines of a `--json` run: `output` frames on the `logs`
 *  source's data channel, which is where the command reports each line
 *  the platform captured from the app. */
function logLines(run: CliRun): string[] {
  return run.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .flatMap((line) => {
      try {
        return [
          JSON.parse(line) as {
            kind?: string;
            source?: string;
            channel?: string;
            line?: string;
          },
        ];
      } catch {
        return [];
      }
    })
    .filter(
      (frame) =>
        frame.kind === "output" &&
        frame.source === "logs" &&
        frame.channel === "data" &&
        typeof frame.line === "string",
    )
    .map((frame) => frame.line as string);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** A fresh hostname does not serve on the first try — the edge is
 *  still setting up routing and TLS for it — so the request retries
 *  until the app answers. */
async function serveProbeRequest(url: string, path: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastAnswer: number | string = "never reached";
  for (;;) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: each retry decides from the previous answer; waiting between requests is the point.
      const served = await fetch(`${url}${path}`);
      lastAnswer = served.status;
      if (served.ok) {
        return;
      }
    } catch (failure) {
      lastAnswer = failure instanceof Error ? failure.message : "error";
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the deployment at ${url} never served the probe request; ` +
          `last answer: ${lastAnswer}`,
      );
    }
    await sleep(3000);
  }
}

/** Ingestion lags a request by some unspecified amount, so `service
 *  logs` is polled until `wantedLine` arrives (or the deadline passes,
 *  leaving the assertions to report what the last read held). */
async function pollLogsForLine(
  serviceName: string,
  wantedLine: string,
): Promise<string[]> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: polling one page at a time is the point, as in the command's own --follow loop.
    const run = await scratch.run([
      "service",
      "logs",
      "--service",
      serviceName,
    ]);
    const lines = logLines(run);
    if (
      lines.some((line) => line.includes(wantedLine)) ||
      Date.now() > deadline
    ) {
      return lines;
    }
    await sleep(5000);
  }
}

describeCommand("service logs", () => {
  it("reads back what the deployment wrote while serving a request", async () => {
    const existing = requireDeployed();
    // Rollback made the first deployment live again, so it is what
    // `service logs` reads by default. Serve one request against it so
    // there is a line whose ingestion this run can be pinned to.
    const shown = await scratch.run([
      "service",
      "deployment",
      "show",
      existing.deploymentId,
    ]);
    const url = (shown.envelope.result as { deployment: DeploymentRow })
      .deployment.url;
    expect(url).toMatch(HTTPS_URL);
    await serveProbeRequest(url as string, "/e2e-logs-probe");

    const lines = await pollLogsForLine(
      existing.serviceName,
      "e2e-fixture served /e2e-logs-probe",
    );
    expect(lines.some((line) => line.includes("e2e-fixture listening"))).toBe(
      true,
    );
    expect(
      lines.some((line) => line.includes("e2e-fixture served /e2e-logs-probe")),
    ).toBe(true);
  });
});

describeCommand("service deployment stop", () => {
  it("stops the running deployment", async () => {
    const existing = requireDeployed();
    const run = await scratch.run([
      "service",
      "deployment",
      "stop",
      existing.deploymentId,
      "--service",
      existing.serviceName,
    ]);
    const stopped = run.envelope.result as {
      readonly deployment: DeploymentRow;
      readonly alreadyInState: boolean;
    };

    expect(stopped.deployment.id).toBe(existing.deploymentId);
    expect(stopped.deployment.status).toBe("stopped");
    expect(stopped.alreadyInState).toBe(false);
    // Stopping takes it out of service, so it is no longer the live one.
    expect(stopped.deployment.live).toBeNull();
  });
});

describeCommand("service deployment delete", () => {
  it("deletes the deployment, and the listing no longer reports it", async () => {
    const existing = requireDeployed();
    const run = await scratch.run([
      "service",
      "deployment",
      "delete",
      existing.deploymentId,
      "--service",
      existing.serviceName,
      "--confirm",
      existing.deploymentId,
    ]);
    const removed = run.envelope.result as {
      readonly projectId: string;
      readonly deploymentId: string;
      readonly deleted: boolean;
    };

    expect(removed.projectId).toBe(scratch.project().id);
    expect(removed.deploymentId).toBe(existing.deploymentId);
    expect(removed.deleted).toBe(true);
    // Teardown has nothing left to remove.
    deployed = undefined;

    const after = await scratch.run([
      "service",
      "deployment",
      "list",
      "--service",
      existing.serviceName,
    ]);
    const remaining = after.envelope.result as {
      readonly deployments: readonly DeploymentRow[];
    };
    expect(
      remaining.deployments.map((deployment) => deployment.id),
    ).not.toContain(existing.deploymentId);
  });
});
