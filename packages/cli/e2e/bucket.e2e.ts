/**
 * The object-store lifecycle against the real API: create a bucket in a
 * scratch project, mint and revoke an access key, then delete it.
 */
import { expect, it } from "vitest";

import { scratchName } from "./harness";
import { useScratchProject } from "./scratch";
import { describeCommand } from "./suite";

const scratch = useScratchProject("bucket");

let bucketId: string | undefined;
let keyId: string | undefined;

function requireBucket(): string {
  if (bucketId === undefined) {
    throw new Error("bucket create did not run or did not report an id");
  }
  return bucketId;
}

function requireKey(): string {
  if (keyId === undefined) {
    throw new Error("bucket key create did not run or did not report an id");
  }
  return keyId;
}

describeCommand("bucket create", () => {
  it("creates a bucket in the scratch project", async () => {
    const run = await scratch.run([
      "bucket",
      "create",
      "--name",
      scratchName("bkt"),
    ]);
    const created = run.envelope.result as {
      readonly bucket: { readonly id: string };
    };

    expect(created.bucket.id).toBeTruthy();
    bucketId = created.bucket.id;
  });
});

describeCommand("bucket list", () => {
  it("lists the bucket that was just created", async () => {
    const run = await scratch.run(["bucket", "list"]);

    expect(run.envelope.ok).toBe(true);
    expect(JSON.stringify(run.envelope.result)).toContain(requireBucket());
  });
});

describeCommand("bucket key create", () => {
  it("mints an access key for the bucket", async () => {
    const run = await scratch.run([
      "bucket",
      "key",
      "create",
      requireBucket(),
      "--role",
      "read",
      "--name",
      scratchName("key"),
    ]);
    const created = run.envelope.result as {
      readonly key: { readonly id: string };
    };

    expect(created.key.id).toBeTruthy();
    keyId = created.key.id;
  });
});

describeCommand("bucket key list", () => {
  it("lists the key that was just minted", async () => {
    const run = await scratch.run(["bucket", "key", "list", requireBucket()]);

    expect(run.envelope.ok).toBe(true);
    expect(JSON.stringify(run.envelope.result)).toContain(requireKey());
  });
});

describeCommand("bucket key delete", () => {
  it("deletes the access key", async () => {
    const run = await scratch.run([
      "bucket",
      "key",
      "delete",
      requireBucket(),
      requireKey(),
      "--confirm",
      requireKey(),
    ]);

    expect(run.envelope.ok).toBe(true);
  });
});

describeCommand("bucket delete", () => {
  it("deletes the bucket", async () => {
    const id = requireBucket();
    const run = await scratch.run(["bucket", "delete", id, "--confirm", id]);

    expect(run.envelope.ok).toBe(true);
  });
});
