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
 * Teardown must delete the version before the scratch project can go.
 */
import { afterAll, expect, it } from "vitest";

import { deleteDeployment, deployService } from "./deployed-service";
import { scratchName } from "./harness";
import { useScratchProject } from "./scratch";
import { describeCommand } from "./suite";

const HTTPS_URL = /^https:\/\//;

const scratch = useScratchProject("service-version");

let deployed:
  | { serviceId: string; serviceName: string; deploymentId: string }
  | undefined;

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
