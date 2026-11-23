/**
 * The custom domain commands, against a hostname nobody owns.
 *
 * The platform keeps a hostname before its DNS exists and says what is
 * still missing, so add, show, retry and delete all have a real happy
 * path without a DNS record. The hostname is under `.example`, which is
 * reserved and never resolves, so it stays `not_verified` for the whole
 * file. `service domain wait` only succeeds once a hostname serves,
 * which needs DNS for a domain the test account owns; it is run here
 * with `--timeout 0` to prove its one read against the real API, and
 * its happy path stays owed in `tests/e2e-coverage.test.ts`.
 *
 * The blocks run in file order and share one service and one hostname.
 */
import { afterAll, expect, it } from "vitest";

import { apiBaseUrl, serviceToken } from "./deployed-service";
import { scratchName } from "./harness";
import { useScratchProject } from "./scratch";
import { describeCommand } from "./suite";

const scratch = useScratchProject("service-domain");

const hostname = `${scratchName("dom")}.prisma-cli-e2e.example`;

interface DomainRow {
  readonly id: string;
  readonly hostname: string;
  readonly serviceId: string | null;
  readonly status: string;
  readonly state: string;
  readonly firstUnmetCondition: string | null;
  readonly dnsRecords: ReadonlyArray<{
    readonly condition: string;
    readonly type: string;
    readonly name: string;
    readonly value: string;
  }>;
}

let fixture:
  | { serviceId: string; serviceName: string; workspaceId: string }
  | undefined;
let added: DomainRow | undefined;

function requireFixture(): {
  serviceId: string;
  serviceName: string;
  workspaceId: string;
} {
  if (fixture === undefined) {
    throw new Error("the domain fixture did not run");
  }
  return fixture;
}

function domainArgs(command: string): string[] {
  return [
    "service",
    "domain",
    command,
    hostname,
    "--service",
    requireFixture().serviceName,
  ];
}

/**
 * Adding a hostname leaves an unverified domain ownership in the
 * workspace, which no CLI command removes. Without this, every run
 * would leave one behind.
 */
async function deleteDomainOwnerships(workspaceId: string): Promise<void> {
  const headers = { authorization: `Bearer ${serviceToken()}` };
  const listing = await fetch(
    `${apiBaseUrl()}/v1/workspaces/${workspaceId}/domain-ownerships?domain=${hostname}`,
    { headers },
  );
  if (!listing.ok) {
    console.warn(
      `e2e teardown could not list domain ownerships for ${hostname}: HTTP ${listing.status}`,
    );
    return;
  }
  const { data } = (await listing.json()) as { data: Array<{ id: string }> };
  await Promise.all(
    data.map(async (ownership) => {
      const removal = await fetch(
        `${apiBaseUrl()}/v1/domain-ownerships/${ownership.id}`,
        { method: "DELETE", headers },
      );
      if (!removal.ok) {
        console.warn(
          `e2e teardown could not delete domain ownership ${ownership.id}: HTTP ${removal.status}`,
        );
      }
    }),
  );
}

afterAll(async () => {
  if (fixture !== undefined) {
    await deleteDomainOwnerships(fixture.workspaceId).catch((failure) => {
      console.warn(
        `e2e teardown could not delete domain ownerships: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
    });
  }
});

describeCommand("service domain add", () => {
  it("adds a hostname before its DNS exists, and says which records to publish", async () => {
    const created = await scratch.run([
      "service",
      "create",
      scratchName("dom"),
    ]);
    const service = (
      created.envelope.result as { service: { id: string; name: string } }
    ).service;

    const run = await scratch.run([
      "service",
      "domain",
      "add",
      hostname,
      "--service",
      service.name,
    ]);
    const result = run.envelope.result as {
      readonly workspace: { readonly id: string };
      readonly service: { readonly id: string };
      readonly domain: DomainRow;
      readonly existing: boolean;
    };
    fixture = {
      serviceId: service.id,
      serviceName: service.name,
      workspaceId: result.workspace.id,
    };
    added = result.domain;

    expect(result.existing).toBe(false);
    expect(result.service.id).toBe(service.id);
    expect(result.domain.hostname).toBe(hostname);
    expect(result.domain.serviceId).toBe(service.id);
    expect(result.domain.status).toBe("pending");
    expect(result.domain.state).toBe("not_verified");
    expect(result.domain.firstUnmetCondition).toBe("ownershipVerified");
    expect(result.domain.dnsRecords).toContainEqual(
      expect.objectContaining({
        condition: "ownershipVerified",
        type: "TXT",
        name: `_prisma-verification.${hostname}`,
      }),
    );
  });

  it("answers with the existing hostname when it is added again", async () => {
    const run = await scratch.run(domainArgs("add"));
    const result = run.envelope.result as {
      readonly domain: DomainRow;
      readonly existing: boolean;
    };

    expect(result.existing).toBe(true);
    expect(result.domain.id).toBe(added?.id);
  });
});

describeCommand("service domain show", () => {
  it("shows the hostname's state and the records it still needs", async () => {
    const run = await scratch.run(domainArgs("show"));
    const shown = (run.envelope.result as { readonly domain: DomainRow })
      .domain;

    expect(shown.id).toBe(added?.id);
    expect(shown.hostname).toBe(hostname);
    expect(shown.state).toBe("not_verified");
    expect(shown.dnsRecords.map((record) => record.type)).toContain("TXT");
  });

  it("reads the same state through wait, which gives up at once with --timeout 0", async () => {
    const run = await scratch.run([...domainArgs("wait"), "--timeout", "0"], {
      expectOk: false,
    });

    expect(run.envelope.error?.code).toBe(
      "SERVICE.DOMAIN_VERIFICATION_TIMEOUT",
    );
    expect(run.envelope.error?.meta).toEqual({ state: "not_verified" });
  });
});

describeCommand("service domain retry", () => {
  it("checks the hostname again and reports that ownership is still unproven", async () => {
    const run = await scratch.run(domainArgs("retry"));
    const checked = (run.envelope.result as { readonly domain: DomainRow })
      .domain;

    expect(checked.id).toBe(added?.id);
    expect(checked.status).toBe("pending");
    expect(checked.state).toBe("not_verified");
  });
});

describeCommand("service domain delete", () => {
  it("deletes the hostname, and the service no longer lists it", async () => {
    const deletion = await scratch.run([
      ...domainArgs("delete"),
      "--confirm",
      hostname,
    ]);
    const deleted = deletion.envelope.result as {
      readonly hostname: string;
      readonly deleted: boolean;
    };

    expect(deleted.hostname).toBe(hostname);
    expect(deleted.deleted).toBe(true);

    const after = await scratch.run(domainArgs("show"), { expectOk: false });
    expect(after.envelope.error?.code).toBe("SERVICE.DOMAIN_NOT_FOUND");
  });
});
