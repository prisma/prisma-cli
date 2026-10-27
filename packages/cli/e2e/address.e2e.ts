/**
 * Node addresses as subjects, against the real API: `@<environment>:<address>`
 * names a row by the Project's and the row's `logicalId` and the Branch's
 * git name, the way Composer deploys them.
 *
 * The CLI cannot set a `logicalId`, so this file builds what Composer
 * would through the management API: a Project whose `logicalId` is the
 * app name, a default and a preview Branch, and on each a database with
 * the same address. The preview Branch also carries a deployed service
 * and a bucket; the default Branch an undeployed service with the same
 * address as the deployed one. Every pair that shares an address is
 * there to prove the environment picks the Branch.
 */
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  apiBaseUrl,
  createDeployment,
  deleteDeployment,
  serviceToken,
} from "./deployed-service";
import { isScratchName, scratchDatabaseName, scratchName } from "./harness";
import { removeScratchProject } from "./scratch";
import { describeCommand, describeCommands, session } from "./suite";

const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 3000;

async function managementApi<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${serviceToken()}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(
      `${method} ${path}: HTTP ${response.status} ${await response.text()}`,
    );
  }
  return ((await response.json()) as { data: T }).data;
}

interface Row {
  readonly id: string;
  readonly name: string;
}

interface Branch {
  readonly id: string;
  readonly gitName: string;
  readonly isDefault: boolean;
}

async function defaultBranch(projectId: string): Promise<Branch> {
  const branches = await managementApi<Branch[]>(
    "GET",
    `/v1/projects/${projectId}/branches`,
  );
  const existing = branches.find((branch) => branch.isDefault);
  if (existing !== undefined) {
    return existing;
  }
  // The first Branch a Project gets is its default, whatever is asked.
  return managementApi<Branch>("POST", `/v1/projects/${projectId}/branches`, {
    gitName: "main",
  });
}

async function createReadyDatabase(
  projectId: string,
  branchId: string,
  logicalId: string,
): Promise<Row> {
  const created = await managementApi<Row & { status: string }>(
    "POST",
    "/v1/databases",
    { projectId, branchId, logicalId, name: scratchDatabaseName("addr") },
  );
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let status = created.status;
  while (status !== "ready") {
    if (Date.now() > deadline) {
      throw new Error(`database ${created.id} is still ${status}`);
    }
    // biome-ignore lint/performance/noAwaitInLoops: polling one database until it is ready.
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    status = (
      await managementApi<{ status: string }>(
        "GET",
        `/v1/databases/${created.id}`,
      )
    ).status;
  }
  return created;
}

interface Fixture {
  readonly project: Row & { readonly cwd: string };
  readonly app: string;
  readonly environment: string;
  readonly productionDatabase: Row;
  readonly previewDatabase: Row;
  readonly productionService: Row;
  readonly previewService: Row & { readonly deploymentId: string };
  readonly bucket: Row;
}

let fixture: Fixture | undefined;
let project: (Row & { cwd: string }) | undefined;
let deployment: { id: string; serviceName: string } | undefined;

function requireFixture(): Fixture {
  if (fixture === undefined) {
    throw new Error("the address fixture did not finish setting up");
  }
  return fixture;
}

beforeAll(async () => {
  const cli = await session();
  const cwd = await cli.workdir();
  const app = scratchName("addr");
  const created = await managementApi<Row>("POST", "/v1/projects", {
    name: app,
    logicalId: app,
    createDatabase: false,
  });
  project = { ...created, cwd };

  const production = await defaultBranch(project.id);
  const environment = scratchName("pr");
  const preview = await managementApi<Branch>(
    "POST",
    `/v1/projects/${project.id}/branches`,
    { gitName: environment },
  );

  const catalog = `${app}.catalog`;
  const api = `${app}.api`;
  const [productionDatabase, previewDatabase] = await Promise.all([
    createReadyDatabase(project.id, production.id, catalog),
    createReadyDatabase(project.id, preview.id, catalog),
  ]);
  const createService = (branchId: string) =>
    managementApi<Row>("POST", "/v1/services", {
      projectId: project?.id,
      branchId,
      logicalId: api,
      displayName: scratchName("svc"),
    });
  const productionService = await createService(production.id);
  const previewService = await createService(preview.id);
  const bucket = await managementApi<Row>("POST", "/v1/buckets", {
    projectId: project.id,
    branchId: preview.id,
    logicalId: `${app}.files`,
    name: scratchName("bkt"),
  });

  const deploymentId = await createDeployment(previewService.id);
  deployment = { id: deploymentId, serviceName: previewService.name };
  await cli.run(["service", "version", "start", deploymentId], { cwd });
  await cli.run(["service", "version", "promote", deploymentId], { cwd });

  fixture = {
    project,
    app,
    environment,
    productionDatabase,
    previewDatabase,
    productionService,
    previewService: { ...previewService, deploymentId },
    bucket,
  };
});

afterAll(async () => {
  const cli = await session();
  if (deployment !== undefined) {
    await deleteDeployment(
      {
        run: (args, options) =>
          cli.run(args, { cwd: project?.cwd, ...options }),
      },
      deployment,
    );
  }
  if (project === undefined) {
    return;
  }
  if (!isScratchName(project.name)) {
    throw new Error(
      `refusing to remove "${project.name}": not an e2e scratch project`,
    );
  }
  await removeScratchProject(cli, project);
});

async function run(args: readonly string[], expectOk = true) {
  const cli = await session();
  return cli.run(args, { cwd: requireFixture().project.cwd, expectOk });
}

interface OutputFrame {
  readonly kind: string;
  readonly channel?: string;
  readonly line?: string;
}

function outputLines(stdout: string, channel: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as OutputFrame)
    .filter((frame) => frame.kind === "output" && frame.channel === channel)
    .map((frame) => frame.line ?? "");
}

describeCommand("service logs", () => {
  it("reads the live version of the service an environment address names", async () => {
    const { app, environment, previewService } = requireFixture();
    const result = await run(["service", "logs", `@${environment}:${app}.api`]);

    const diagnostics = outputLines(result.stdout, "diagnostic");
    expect(diagnostics).toContain(`service: ${previewService.name}`);
    expect(diagnostics).toContain(`version: ${previewService.deploymentId}`);
  });
});

describeCommands(["service show", "project show"], () => {
  it("resolves an address with no environment to the default branch", async () => {
    const { app, project: scratch, productionService } = requireFixture();
    const result = await run(["service", "show", `@${app}.api`]);
    const shown = result.envelope.result as {
      readonly projectId: string;
      readonly service: Row;
      readonly liveVersion: unknown;
    };

    expect(shown.projectId).toBe(scratch.id);
    expect(shown.service.id).toBe(productionService.id);
    expect(shown.liveVersion).toBeNull();
  });

  it("resolves the same address in a named environment to that branch's row", async () => {
    const { app, environment, previewService } = requireFixture();
    const result = await run(["service", "show", `@${environment}:${app}.api`]);
    const shown = result.envelope.result as {
      readonly service: Row;
      readonly liveVersion: { readonly id: string } | null;
    };

    expect(shown.service.id).toBe(previewService.id);
    expect(shown.liveVersion?.id).toBe(previewService.deploymentId);
  });

  it("resolves the app name alone to the Project", async () => {
    const { app, project: scratch } = requireFixture();
    const result = await run(["project", "show", `@${app}`]);
    const shown = result.envelope.result as { readonly project: Row };

    expect(shown.project.id).toBe(scratch.id);
    expect(shown.project.name).toBe(app);
  });
});

describeCommands(["bucket key list", "bucket delete"], () => {
  it("lists the keys of the bucket an address names", async () => {
    const { app, environment, bucket } = requireFixture();
    const result = await run([
      "bucket",
      "key",
      "list",
      `@${environment}:${app}.files`,
    ]);
    const listed = result.envelope.result as { readonly bucketId: string };

    expect(listed.bucketId).toBe(bucket.id);
  });

  it("says which kind an address is when the command expects another", async () => {
    const { app, environment } = requireFixture();
    const address = `@${environment}:${app}.files`;
    const result = await run(["postgres", "show", address], false);

    expect(result.envelope.error?.code).toBe("ADDRESS.WRONG_KIND");
    expect(result.envelope.error?.meta).toMatchObject({
      address,
      expected: "database",
      actual: "bucket",
    });
  });

  it("deletes the bucket an address names, with the address as consent", async () => {
    const { app, environment, bucket } = requireFixture();
    const address = `@${environment}:${app}.files`;
    const result = await run([
      "bucket",
      "delete",
      address,
      "--confirm",
      address,
    ]);
    const deleted = result.envelope.result as { readonly bucket: Row };

    expect(deleted.bucket.id).toBe(bucket.id);
  });
});

describeCommands(["postgres show", "postgres delete"], () => {
  it("shows the database an environment address names", async () => {
    const { app, environment, previewDatabase } = requireFixture();
    const result = await run([
      "postgres",
      "show",
      `@${environment}:${app}.catalog`,
    ]);
    const shown = result.envelope.result as { readonly database: Row };

    expect(shown.database.id).toBe(previewDatabase.id);
  });

  it("refuses the row id as consent when the subject is an address", async () => {
    const { app, environment, previewDatabase } = requireFixture();
    const result = await run(
      [
        "postgres",
        "delete",
        `@${environment}:${app}.catalog`,
        "--confirm",
        previewDatabase.id,
      ],
      false,
    );

    expect(result.envelope.error?.code).toBe("CLI.CONSENT_REQUIRED");
    const after = await run([
      "postgres",
      "show",
      `@${environment}:${app}.catalog`,
    ]);
    expect(
      (after.envelope.result as { readonly database: Row }).database.id,
    ).toBe(previewDatabase.id);
  });

  it("deletes only the named environment's database", async () => {
    const { app, environment, previewDatabase, productionDatabase } =
      requireFixture();
    const address = `@${environment}:${app}.catalog`;
    const result = await run([
      "postgres",
      "delete",
      address,
      "--confirm",
      address,
    ]);
    const deleted = result.envelope.result as { readonly database: Row };
    expect(deleted.database.id).toBe(previewDatabase.id);

    const production = await run(["postgres", "show", `@${app}.catalog`]);
    expect(
      (production.envelope.result as { readonly database: Row }).database.id,
    ).toBe(productionDatabase.id);
  });

  it("reports an address nothing is deployed at", async () => {
    const { app, environment } = requireFixture();
    const address = `@${environment}:${app}.catalog`;
    const result = await run(["postgres", "show", address], false);

    expect(result.envelope.error?.code).toBe("ADDRESS.NOT_FOUND");
    expect(result.envelope.error?.meta).toMatchObject({
      address,
      expected: "database",
    });
  });
});
