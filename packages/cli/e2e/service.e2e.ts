/**
 * Creating and enumerating services against the real API, without
 * deploying anything: `service create` is the only way to make a service
 * exist on its own, and `service list` is what proves it did.
 *
 * The blocks run in file order, so the service one creates is the one
 * the next two read and then delete. `service delete` asserts like any
 * other case rather than swallowing failures: the scratch project's
 * teardown removes everything it contains regardless, so nothing here
 * has to double as cleanup.
 */
import { expect, it } from "vitest";

import { scratchName } from "./harness";
import { useScratchProject } from "./scratch";
import { describeCommand } from "./suite";

const scratch = useScratchProject("service");

let serviceName: string | undefined;
let serviceId: string | undefined;

function requireService(): { id: string; name: string } {
  if (serviceId === undefined || serviceName === undefined) {
    throw new Error("service create did not run or did not report a service");
  }
  return { id: serviceId, name: serviceName };
}

interface ServiceRow {
  readonly id: string;
  readonly name: string;
  readonly region: string | null;
  readonly liveDeploymentId: string | null;
  readonly liveUrl: string | null;
}

describeCommand("service create", () => {
  it("creates a service with no region or branch given", async () => {
    const name = scratchName("svc");
    const run = await scratch.run(["service", "create", name]);
    const created = run.envelope.result as {
      readonly projectId: string;
      readonly branch: string;
      readonly service: ServiceRow;
      readonly existing: boolean;
    };

    expect(created.projectId).toBe(scratch.project().id);
    expect(created.service.id).toBeTruthy();
    expect(created.service.name).toBe(name);
    expect(created.existing).toBe(false);
    // No --region: the API picks the default and reports which one.
    expect(created.service.region).toBeTruthy();
    // No --branch: the command falls back to main, and the API creates
    // that branch if the fresh project does not have it yet.
    expect(created.branch).toBe("main");
    // Nothing has been deployed, so the endpoint domain the service
    // already carries is not presented as a live URL.
    expect(created.service.liveDeploymentId).toBeNull();
    expect(created.service.liveUrl).toBeNull();

    serviceId = created.service.id;
    serviceName = created.service.name;
  });

  it("answers with the existing service when the name is taken", async () => {
    const existing = requireService();
    const run = await scratch.run(["service", "create", existing.name]);
    const result = run.envelope.result as {
      readonly service: ServiceRow;
      readonly existing: boolean;
    };

    expect(result.service.id).toBe(existing.id);
    expect(result.existing).toBe(true);
  });
});

describeCommand("service list", () => {
  it("lists the service that create made", async () => {
    const existing = requireService();
    const run = await scratch.run(["service", "list"]);
    const listed = run.envelope.result as {
      readonly projectId: string;
      readonly branch: string;
      readonly services: readonly ServiceRow[];
    };

    expect(listed.projectId).toBe(scratch.project().id);
    const found = listed.services.find((service) => service.id === existing.id);
    expect(found?.name).toBe(existing.name);
    // Still undeployed, so still no live URL in the listing either.
    expect(found?.liveUrl).toBeNull();
  });
});

describeCommand("service show", () => {
  it("shows the created service, with nothing deployed to it", async () => {
    const existing = requireService();
    const run = await scratch.run([
      "service",
      "show",
      "--service",
      existing.name,
    ]);
    const shown = run.envelope.result as {
      readonly projectId: string;
      readonly service: { readonly id: string; readonly name: string };
      readonly liveDeployment: unknown;
      readonly liveUrl: string | null;
      readonly recentDeployments: readonly unknown[];
    };

    expect(shown.projectId).toBe(scratch.project().id);
    expect(shown.service.id).toBe(existing.id);
    expect(shown.service.name).toBe(existing.name);
    // `service create` does not deploy, so these three state the same
    // fact three ways, and each is a separate chance to invent one: no
    // promoted deployment, so no live URL, and no history to show.
    expect(shown.liveDeployment).toBeNull();
    expect(shown.liveUrl).toBeNull();
    expect(shown.recentDeployments).toEqual([]);
  });
});

describeCommand("service delete", () => {
  it("deletes the service, and the listing no longer reports it", async () => {
    const existing = requireService();
    const deletion = await scratch.run([
      "service",
      "delete",
      "--service",
      existing.name,
      "--confirm",
      existing.name,
    ]);
    const deleted = deletion.envelope.result as {
      readonly projectId: string;
      readonly service: { readonly id: string; readonly name: string };
      readonly deleted: boolean;
    };

    expect(deleted.projectId).toBe(scratch.project().id);
    expect(deleted.service.id).toBe(existing.id);
    expect(deleted.deleted).toBe(true);

    const after = await scratch.run(["service", "list"]);
    const remaining = after.envelope.result as {
      readonly services: readonly ServiceRow[];
    };
    expect(remaining.services.map((service) => service.id)).not.toContain(
      existing.id,
    );
  });
});
