/**
 * The version verbs, against a service this file deploys to.
 *
 * Every command here needs a version to act on, which is why they
 * had no coverage: the CLI cannot make one, and only Composer does.
 * `deployed-service.ts` does what Composer does through the management
 * API, so these commands can finally be run rather than reasoned about.
 *
 * The blocks run in file order and share one service: it is deployed
 * once, read by the middle blocks, then stopped and deleted at the end.
 * The rollback block adds a second version, promotes it, and rolls
 * back to the first, so the later blocks still act on a live first
 * version. Teardown must delete every version before the scratch
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

const scratch = useScratchProject("service-version");

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
    throw new Error("the version fixture did not run");
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

describeCommand("service version promote", () => {
  it("deploys a service and promotes the version live", async () => {
    // `deployService` runs `service version start` and then
    // `service version promote`; both are commands under test, so a
    // failure in either fails here rather than somewhere downstream.
    deployed = await deployService(scratch, scratchName("dep"));

    const run = await scratch.run([
      "service",
      "version",
      "show",
      deployed.deploymentId,
    ]);
    const shown = run.envelope.result as { version: DeploymentRow };

    expect(shown.version.id).toBe(deployed.deploymentId);
    expect(shown.version.live).toBe(true);
    expect(shown.version.status).toBe("running");
  });
});

describeCommand("service version start", () => {
  it("reports the version the fixture started as running", async () => {
    const existing = requireDeployed();
    // Starting an already-running version is the idempotent answer,
    // which is the only start this file can make twice.
    const run = await scratch.run([
      "service",
      "version",
      "start",
      existing.deploymentId,
    ]);
    const started = run.envelope.result as {
      readonly version: DeploymentRow;
      readonly alreadyInState: boolean;
    };

    expect(started.version.id).toBe(existing.deploymentId);
    expect(started.version.status).toBe("running");
    expect(started.alreadyInState).toBe(true);
  });
});

describeCommand("service version list", () => {
  it("lists the version, and marks it live", async () => {
    const existing = requireDeployed();
    const run = await scratch.run([
      "service",
      "version",
      "list",
      existing.serviceName,
    ]);
    const listed = run.envelope.result as {
      readonly projectId: string;
      readonly service: { readonly id: string };
      readonly versions: readonly DeploymentRow[];
    };

    expect(listed.projectId).toBe(scratch.project().id);
    expect(listed.service.id).toBe(existing.serviceId);
    const found = listed.versions.find(
      (deployment) => deployment.id === existing.deploymentId,
    );
    expect(found?.live).toBe(true);
    expect(found?.url).toBeTruthy();
  });
});

describeCommand("service version show", () => {
  it("shows the version and the service it belongs to", async () => {
    const existing = requireDeployed();
    const run = await scratch.run([
      "service",
      "version",
      "show",
      existing.deploymentId,
    ]);
    const shown = run.envelope.result as {
      readonly service: { readonly id: string; readonly name: string };
      readonly version: DeploymentRow;
    };

    expect(shown.service.id).toBe(existing.serviceId);
    expect(shown.service.name).toBe(existing.serviceName);
    expect(shown.version.id).toBe(existing.deploymentId);
    expect(Date.parse(shown.version.createdAt)).not.toBeNaN();
  });
});

describeCommand("service version rollback", () => {
  it("rolls production back to the previously live version", async () => {
    const existing = requireDeployed();
    // Rolling back needs somewhere to roll back from: a second
    // version, promoted over the first. It is tracked for teardown
    // before anything can throw, because `project delete` refuses while
    // it exists.
    const secondId = await createDeployment(existing.serviceId);
    secondDeployment = { id: secondId, serviceName: existing.serviceName };
    await scratch.run(["service", "version", "start", secondId]);
    await scratch.run(["service", "version", "promote", secondId]);

    // No --to: the default target is the version before the live
    // one, which is the first. --confirm must name that target.
    const run = await scratch.run([
      "service",
      "version",
      "rollback",
      existing.serviceName,
      "--confirm",
      existing.deploymentId,
    ]);
    const rolledBack = run.envelope.result as {
      readonly service: { readonly id: string };
      readonly version: DeploymentRow;
      readonly previousLiveVersionId: string | null;
    };

    expect(rolledBack.service.id).toBe(existing.serviceId);
    expect(rolledBack.version.id).toBe(existing.deploymentId);
    expect(rolledBack.version.live).toBe(true);
    expect(rolledBack.previousLiveVersionId).toBe(secondId);

    const shown = await scratch.run([
      "service",
      "version",
      "show",
      existing.deploymentId,
    ]);
    const after = shown.envelope.result as { version: DeploymentRow };
    expect(after.version.live).toBe(true);
  });
});

describeCommand("service open", () => {
  it("answers with the service's URL rather than opening one", async () => {
    const existing = requireDeployed();
    // No browser and no TTY in CI, so the command reports the URL it
    // would have opened. That it declined to open is part of the
    // contract, not an incidental detail.
    const run = await scratch.run(["service", "open", existing.serviceName]);
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
      const served = await fetch(`${url}${path}`, {
        // A connection that answers nothing must not outlive the
        // retry deadline.
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
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
    const run = await scratch.run(["service", "logs", serviceName]);
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
  it("reads back what the version wrote while serving a request", async () => {
    const existing = requireDeployed();
    // Rollback made the first version live again, so it is what
    // `service logs` reads by default. Serve one request against it so
    // there is a line whose ingestion this run can be pinned to.
    const shown = await scratch.run([
      "service",
      "version",
      "show",
      existing.deploymentId,
    ]);
    const url = (shown.envelope.result as { version: DeploymentRow }).version
      .url;
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

describeCommand("service version stop", () => {
  it("stops the running version", async () => {
    const existing = requireDeployed();
    const run = await scratch.run([
      "service",
      "version",
      "stop",
      existing.deploymentId,
    ]);
    const stopped = run.envelope.result as {
      readonly version: DeploymentRow;
      readonly alreadyInState: boolean;
    };

    expect(stopped.version.id).toBe(existing.deploymentId);
    expect(stopped.version.status).toBe("stopped");
    expect(stopped.alreadyInState).toBe(false);
    // Stopping takes it out of service, so it is no longer the live one.
    expect(stopped.version.live).toBeNull();
  });
});

describeCommand("service version delete", () => {
  it("deletes the version, and the listing no longer reports it", async () => {
    const existing = requireDeployed();
    const run = await scratch.run([
      "service",
      "version",
      "delete",
      existing.deploymentId,
      "--confirm",
      existing.deploymentId,
    ]);
    const removed = run.envelope.result as {
      readonly versionId: string;
      readonly deleted: boolean;
    };

    expect(removed.versionId).toBe(existing.deploymentId);
    expect(removed.deleted).toBe(true);
    // Teardown has nothing left to remove.
    deployed = undefined;

    const after = await scratch.run([
      "service",
      "version",
      "list",
      existing.serviceName,
    ]);
    const remaining = after.envelope.result as {
      readonly versions: readonly DeploymentRow[];
    };
    expect(remaining.versions.map((deployment) => deployment.id)).not.toContain(
      existing.deploymentId,
    );
  });
});
