/**
 * The object-store lifecycle against the real API: create a bucket in a
 * scratch project, mint and revoke an access key, then delete it.
 *
 * `bucket key create` answers with a live secret access key, so nothing
 * here stringifies a whole envelope — a failed assertion prints its
 * operands, and that would put the secret into the CI log. Assertions
 * read named fields instead, which is the stronger check anyway.
 */
import { expect, it } from "vitest";

import { scratchName } from "./harness";
import { useScratchProject } from "./scratch";
import { describeCommand } from "./suite";

const scratch = useScratchProject("bucket");

const BUCKET_ID = /^bkt_/;
const BUCKET_KEY_ID = /^bkey_/;

let bucketId: string | undefined;
let bucketName: string | undefined;
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

interface BucketRow {
  readonly id: string;
  readonly name: string;
}

interface KeyRow {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

describeCommand("bucket create", () => {
  it("creates a bucket in the scratch project", async () => {
    const name = scratchName("bkt");
    const run = await scratch.run(["bucket", "create", "--name", name]);
    const created = run.envelope.result as {
      readonly projectId: string;
      readonly bucket: BucketRow & { readonly status: string };
    };

    expect(created.projectId).toBe(scratch.project().id);
    expect(created.bucket.id).toMatch(BUCKET_ID);
    expect(created.bucket.name).toBe(name);
    expect(created.bucket.status).toBeTruthy();
    bucketId = created.bucket.id;
    bucketName = created.bucket.name;
  });
});

describeCommand("bucket list", () => {
  it("lists the bucket that was just created", async () => {
    const run = await scratch.run(["bucket", "list"]);
    const listed = run.envelope.result as {
      readonly projectId: string;
      readonly buckets: readonly BucketRow[];
      readonly items: readonly unknown[];
      readonly count: number;
    };

    expect(listed.projectId).toBe(scratch.project().id);
    expect(listed.count).toBe(listed.items.length);
    const mine = listed.buckets.find((bucket) => bucket.id === requireBucket());
    expect(mine?.name).toBe(bucketName);
  });
});

describeCommand("bucket key create", () => {
  it("mints an access key for the bucket", async () => {
    const name = scratchName("key");
    const run = await scratch.run([
      "bucket",
      "key",
      "create",
      requireBucket(),
      "--role",
      "read",
      "--name",
      name,
    ]);
    const created = run.envelope.result as {
      readonly bucketId: string;
      readonly key: KeyRow;
      readonly secretAccessKey: string;
    };

    expect(created.bucketId).toBe(requireBucket());
    expect(created.key.id).toMatch(BUCKET_KEY_ID);
    expect(created.key.name).toBe(name);
    expect(created.key.role).toBe("read");
    // Checked for presence and shape only — never compared against a
    // literal, and never printed.
    expect(typeof created.secretAccessKey).toBe("string");
    expect(created.secretAccessKey.length).toBeGreaterThan(0);
    keyId = created.key.id;
  });
});

describeCommand("bucket key list", () => {
  it("lists the key that was just minted, with its role", async () => {
    const run = await scratch.run(["bucket", "key", "list", requireBucket()]);
    const listed = run.envelope.result as {
      readonly bucketId: string;
      readonly keys: readonly KeyRow[];
      readonly items: readonly unknown[];
      readonly count: number;
    };

    expect(listed.bucketId).toBe(requireBucket());
    expect(listed.count).toBe(listed.items.length);
    const mine = listed.keys.find((key) => key.id === requireKey());
    expect(mine?.role).toBe("read");
  });
});

describeCommand("bucket key delete", () => {
  it("deletes the access key, and the list agrees", async () => {
    const run = await scratch.run([
      "bucket",
      "key",
      "delete",
      requireBucket(),
      requireKey(),
      "--confirm",
      requireKey(),
    ]);
    const deleted = run.envelope.result as {
      readonly key: { readonly id: string };
    };

    expect(deleted.key.id).toBe(requireKey());

    const after = await scratch.run(["bucket", "key", "list", requireBucket()]);
    const listed = after.envelope.result as {
      readonly keys: readonly KeyRow[];
    };
    expect(listed.keys.map((key) => key.id)).not.toContain(requireKey());
  });
});

describeCommand("bucket delete", () => {
  it("deletes the bucket, and the list agrees", async () => {
    const run = await scratch.run([
      "bucket",
      "delete",
      requireBucket(),
      "--confirm",
      requireBucket(),
    ]);
    const deleted = run.envelope.result as {
      readonly bucket: { readonly id: string };
    };

    expect(deleted.bucket.id).toBe(requireBucket());

    const after = await scratch.run(["bucket", "list"]);
    const listed = after.envelope.result as {
      readonly buckets: readonly BucketRow[];
    };
    expect(listed.buckets.map((bucket) => bucket.id)).not.toContain(
      requireBucket(),
    );
  });
});
