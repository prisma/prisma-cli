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
 * Teardown must delete the deployment before the scratch project can go.
 */
import { afterAll, expect, it } from "vitest";

import { deleteDeployment, deployService } from "./deployed-service";
import { scratchName } from "./harness";
import { useScratchProject } from "./scratch";
import { describeCommand } from "./suite";

const HTTPS_URL = /^https:\/\//;

const scratch = useScratchProject("service-deployment");

let deployed:
  | { serviceId: string; serviceName: string; deploymentId: string }
  | undefined;

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
