import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";

import { createTempCwd, executeCli } from "./helpers";

const BUCKET_HELP_ROW = /bucket\s+Manage object-store buckets for a project/;
const BUCKET_ID = /^bkt_/;

const fixturePath = path.resolve("fixtures/mock-api.json");

async function login(cwd: string, stateDir: string) {
  await executeCli({
    argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
    cwd,
    stateDir,
    fixturePath,
  });
}

async function writeLocalPin(cwd: string, projectId = "proj_123") {
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(
    path.join(cwd, ".prisma/local.json"),
    `${JSON.stringify({ workspaceId: "ws_123", projectId }, null, 2)}\n`,
    "utf8",
  );
}

async function setupLinkedProject() {
  const cwd = await createTempCwd();
  const stateDir = path.join(cwd, ".state");
  await login(cwd, stateDir);
  await writeLocalPin(cwd);
  return { cwd, stateDir };
}

describe("bucket commands", () => {
  it("renders bucket and key help", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const root = await executeCli({
      argv: ["--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const bucket = await executeCli({
      argv: ["bucket", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const key = await executeCli({
      argv: ["bucket", "key", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(root.exitCode).toBe(0);
    expect(root.stderr).toMatch(BUCKET_HELP_ROW);

    expect(bucket.exitCode).toBe(0);
    const bucketHelp = stripAnsi(bucket.stderr).replace(/[ \t]+\n/g, "\n");
    expect(bucketHelp).toContain(
      "bucket → Manage object-store buckets for a project",
    );
    expect(bucketHelp).toContain("list");
    expect(bucketHelp).toContain("create");
    expect(bucketHelp).toContain("delete");
    expect(bucketHelp).toContain("key");

    expect(key.exitCode).toBe(0);
    const keyHelp = stripAnsi(key.stderr).replace(/[ \t]+\n/g, "\n");
    expect(keyHelp).toContain(
      "bucket key → Manage access keys for an object-store bucket",
    );
    expect(keyHelp).toContain("list");
    expect(keyHelp).toContain("create");
    expect(keyHelp).toContain("delete");
  });

  it("lists buckets with the standard JSON envelope", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "list", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(payload).toMatchObject({
      ok: true,
      command: "bucket.list",
      result: {
        context: {
          project: "Acme Dashboard",
        },
        items: [
          { name: "acme-preview-store", id: "bkt_123" },
          { name: "acme-production-store", id: "bkt_456" },
        ],
        count: 2,
        projectId: "proj_123",
      },
      warnings: [],
      nextSteps: [],
    });
  });

  it("lists buckets in human-readable format", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "list"],
      cwd,
      stateDir,
      fixturePath,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stderr).toContain("acme-preview-store");
    expect(stderr).toContain("bkt_123");
    expect(stderr).toContain("Acme Dashboard");
    expect(stderr).toContain("Name");
    expect(stderr).toContain("Id");
    expect(stderr).toContain("Status");
  });

  it("creates a bucket and returns JSON with bucket metadata", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "create", "--name", "my-new-store", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(payload).toMatchObject({
      ok: true,
      command: "bucket.create",
      result: {
        bucket: {
          name: "my-new-store",
          status: "ready",
        },
        projectName: "Acme Dashboard",
      },
    });
    expect(payload.result.bucket.id).toMatch(BUCKET_ID);
  });

  it("creates a bucket without a name (auto-generated)", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "create", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.bucket.id).toMatch(BUCKET_ID);
    expect(payload.result.bucket.name).toBeTruthy();
  });

  it("prints a human success message when creating a bucket", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "create", "--name", "my-store"],
      cwd,
      stateDir,
      fixturePath,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stderr).toContain('Created bucket "my-store"');
    expect(stderr).toContain("Acme Dashboard");
  });

  it("deletes a bucket by id", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "delete", "bkt_123", "--confirm", "bkt_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(payload).toMatchObject({
      ok: true,
      command: "bucket.delete",
      result: {
        bucket: { id: "bkt_123" },
      },
    });
  });

  it("requires --confirm matching the bucket id before deletion", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const noConfirm = await executeCli({
      argv: ["bucket", "delete", "bkt_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const noConfirmPayload = JSON.parse(noConfirm.stdout);

    expect(noConfirm.exitCode).toBe(2);
    expect(noConfirmPayload).toMatchObject({
      ok: false,
      command: "bucket.delete",
      error: {
        code: "CONFIRMATION_REQUIRED",
        domain: "bucket",
        meta: { expectedConfirm: "bkt_123", receivedConfirm: null },
      },
    });

    const list = await executeCli({
      argv: ["bucket", "list", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const listPayload = JSON.parse(list.stdout);
    expect(listPayload.result.items).toContainEqual(
      expect.objectContaining({ id: "bkt_123" }),
    );
  });

  it("rejects --confirm that does not match the bucket id", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const wrongConfirm = await executeCli({
      argv: ["bucket", "delete", "bkt_123", "--confirm", "bkt_456", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const wrongPayload = JSON.parse(wrongConfirm.stdout);

    expect(wrongConfirm.exitCode).toBe(2);
    expect(wrongPayload).toMatchObject({
      ok: false,
      command: "bucket.delete",
      error: {
        code: "CONFIRMATION_REQUIRED",
        domain: "bucket",
        meta: { expectedConfirm: "bkt_123", receivedConfirm: "bkt_456" },
      },
    });

    const list = await executeCli({
      argv: ["bucket", "list", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const listPayload = JSON.parse(list.stdout);
    expect(listPayload.result.items).toContainEqual(
      expect.objectContaining({ id: "bkt_123" }),
    );
  });

  it("fails with BUCKET_NOT_FOUND when deleting an unknown bucket", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "delete", "bkt_999", "--confirm", "bkt_999", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload).toMatchObject({
      ok: false,
      command: "bucket.delete",
      error: { code: "BUCKET_NOT_FOUND", domain: "bucket" },
    });
  });

  it("lists bucket keys with the standard JSON envelope", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "key", "list", "bkt_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(payload).toMatchObject({
      ok: true,
      command: "bucket.key.list",
      result: {
        bucketId: "bkt_123",
        keys: [
          {
            id: "bkey_123",
            name: "primary",
            role: "read_write",
          },
        ],
        count: 1,
      },
    });
  });

  it("lists bucket keys in human-readable format", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "key", "list", "bkt_123"],
      cwd,
      stateDir,
      fixturePath,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stderr).toContain("bkt_123");
    expect(stderr).toContain("bkey_123");
    expect(stderr).toContain("primary");
    expect(stderr).toContain("read_write");
  });

  it("creates a bucket key and prints env block to stdout", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "key", "create", "bkt_123"],
      cwd,
      stateDir,
      fixturePath,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("S3_ENDPOINT=");
    expect(result.stdout).toContain("S3_ACCESS_KEY_ID=");
    expect(result.stdout).toContain("S3_SECRET_ACCESS_KEY=");
    expect(result.stdout).toContain("S3_BUCKET=");
    expect(stderr).toContain("Creating bucket key...");
    expect(stderr).toContain("credentials below are shown once");
    expect(result.stdout.split("S3_SECRET_ACCESS_KEY=")).toHaveLength(2);
  });

  it("prints only the env block to stdout when creating a key quietly", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "key", "create", "bkt_123", "--quiet"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("S3_ENDPOINT=");
    expect(result.stdout).toContain("S3_ACCESS_KEY_ID=");
    expect(result.stdout).toContain("S3_SECRET_ACCESS_KEY=");
    expect(result.stdout).toContain("S3_BUCKET=");
  });

  it("returns key credentials in JSON including one-time secrets", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "key", "create", "bkt_123", "--role", "read", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(payload).toMatchObject({
      ok: true,
      command: "bucket.key.create",
      result: {
        bucketId: "bkt_123",
        key: {
          role: "read",
        },
      },
    });
    expect(payload.result.secretAccessKey).toBeTruthy();
    expect(payload.result.accessKeyId).toBeTruthy();
    expect(payload.result.endpoint).toBeTruthy();
    expect(payload.result.bucketName).toBeTruthy();
  });

  it("rejects an invalid key role at parse time", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "key", "create", "bkt_123", "--role", "admin"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("admin");
  });

  it("fails with BRANCH_NOT_FOUND when creating a bucket with a non-existent branch", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "create", "--branch", "nonexistent-branch", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload).toMatchObject({
      ok: false,
      command: "bucket.create",
      error: { code: "BRANCH_NOT_FOUND", domain: "bucket" },
    });
  });

  it("deletes a bucket key by bucket id and key id", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "key", "delete", "bkt_123", "bkey_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(payload).toMatchObject({
      ok: true,
      command: "bucket.key.delete",
      result: {
        key: { id: "bkey_123" },
      },
    });
  });

  it("fails with BUCKET_KEY_NOT_FOUND when deleting an unknown key", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["bucket", "key", "delete", "bkt_123", "bkey_999", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload).toMatchObject({
      ok: false,
      command: "bucket.key.delete",
      error: { code: "BUCKET_KEY_NOT_FOUND", domain: "bucket" },
    });
  });
});
