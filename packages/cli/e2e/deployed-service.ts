/**
 * A service with a promoted deployment, for the commands that cannot be
 * exercised without one.
 *
 * `service create` makes a service, and that is as far as the CLI can
 * get on its own: every deployment verb, `service open` and the custom
 * domain commands act on a deployment, and only Composer produces one.
 * So this fixture does what Composer does, in the three steps the
 * management API exposes — create a deployment, upload an artifact to
 * the pre-signed URL it answers with, then start and promote it through
 * the CLI itself.
 *
 * The artifact is a real tar.gz built here rather than a file checked
 * in, because it has to be a byte stream the platform accepts and a
 * fixture nobody can accidentally break by editing.
 */
import { gzipSync } from "node:zlib";

import type { CliRun, RunOptions } from "./harness";
import { e2eCredentials } from "./harness";

type Runner = {
  run: (args: readonly string[], options?: RunOptions) => Promise<CliRun>;
};

function apiBaseUrl(): string {
  return (
    process.env.PRISMA_MANAGEMENT_API_URL?.trim() || "https://api.prisma.io"
  );
}

function serviceToken(): string {
  const credentials = e2eCredentials();
  if (credentials === null) {
    throw new Error("no e2e credentials; this fixture should not have run");
  }
  return credentials.serviceToken;
}

/** One ustar header plus its content, padded to the 512-byte boundary. */
function tarEntry(name: string, contents: string): Buffer {
  const body = Buffer.from(contents, "utf8");
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "utf8"); // mode
  header.write("0000000\0", 108, 8, "utf8"); // uid
  header.write("0000000\0", 116, 8, "utf8"); // gid
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12);
  header.write("00000000000\0", 136, 12, "utf8"); // mtime, fixed so the
  // artifact is byte-identical between runs
  header.write("        ", 148, 8, "utf8"); // checksum, spaces while summing
  header.write("0", 156, 1, "utf8"); // typeflag: regular file
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");

  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}

/** The smallest thing the platform will run: an HTTP server that
 *  answers, so a started deployment reaches `running` rather than
 *  crash-looping. */
function artifact(): Buffer {
  const tar = Buffer.concat([
    tarEntry(
      "package.json",
      '{"name":"e2e-fixture","version":"1.0.0","type":"module","main":"index.js"}',
    ),
    tarEntry(
      "index.js",
      'import{createServer}from"node:http";' +
        'createServer((_,response)=>{response.writeHead(200);response.end("ok")})' +
        ".listen(process.env.PORT||3000);",
    ),
    Buffer.alloc(1024), // two zero blocks end the archive
  ]);
  return gzipSync(tar);
}

export interface DeployedService {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly deploymentId: string;
}

/** Creates a deployment on an existing service and returns its id,
 *  having uploaded an artifact but not started it. */
export async function createDeployment(serviceId: string): Promise<string> {
  const response = await fetch(
    `${apiBaseUrl()}/v1/apps/${serviceId}/deployments`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ portMapping: { http: 3000 } }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `could not create a deployment: HTTP ${response.status} ${await response.text()}`,
    );
  }
  const created = (await response.json()) as {
    data: { id: string; uploadUrl: string | null };
  };
  if (created.data.uploadUrl === null) {
    throw new Error("the API created a deployment with no upload URL");
  }
  const uploaded = await fetch(created.data.uploadUrl, {
    method: "PUT",
    body: new Uint8Array(artifact()),
  });
  if (!uploaded.ok) {
    throw new Error(`artifact upload failed: HTTP ${uploaded.status}`);
  }
  return created.data.id;
}

/**
 * A service whose deployment is running and live. The two CLI calls are
 * deliberate: `start` and `promote` are commands under test, so the
 * fixture proves them on the way to setting itself up, and a failure in
 * either is reported as a failure to build the fixture rather than as a
 * mysterious later assertion.
 */
export async function deployService(
  cli: Runner,
  serviceName: string,
): Promise<DeployedService> {
  const created = await cli.run(["service", "create", serviceName]);
  const service = (
    created.envelope.result as { service: { id: string; name: string } }
  ).service;

  const deploymentId = await createDeployment(service.id);
  // Once the deployment exists it has to be deleted by someone, and
  // until this function returns the caller has no id to delete. A throw
  // from `start` or `promote` would otherwise leave a deployment nobody
  // knows about, and `project delete` refuses while one exists — so the
  // failure would strand the whole scratch project, not just this
  // service.
  try {
    await cli.run(["service", "deployment", "start", deploymentId]);
    await cli.run(["service", "deployment", "promote", deploymentId]);
  } catch (failure) {
    await deleteDeployment(cli, { id: deploymentId, serviceName });
    throw failure;
  }

  return { serviceId: service.id, serviceName: service.name, deploymentId };
}

/**
 * Deletes a deployment, warning rather than throwing.
 *
 * The scratch project's own teardown cannot do this: `project delete`
 * refuses while a deployment exists — "Cannot delete project: active
 * deployments exist. Please stop and delete all deployments first." — so
 * a file that deploys has to clean up in this order or it strands the
 * whole project.
 */
export async function deleteDeployment(
  cli: Runner,
  deployment: { readonly id: string; readonly serviceName: string },
): Promise<void> {
  try {
    const removal = await cli.run(
      [
        "service",
        "deployment",
        "delete",
        deployment.id,
        "--confirm",
        deployment.id,
      ],
      { expectOk: false },
    );
    if (!removal.envelope.ok) {
      console.warn(
        `e2e teardown could not delete deployment ${deployment.id}: ` +
          `${removal.envelope.error?.code ?? "(no code)"}. The scratch ` +
          "project cannot be deleted until it is gone.",
      );
    }
  } catch (failure) {
    console.warn(
      `e2e teardown could not delete deployment ${deployment.id}: ` +
        `${failure instanceof Error ? failure.message : String(failure)}`,
    );
  }
}
