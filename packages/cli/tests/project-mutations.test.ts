import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createTempCwd, executeCli } from "./helpers";

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

async function setupLinkedProject(projectId = "proj_123") {
  const cwd = await createTempCwd();
  const stateDir = path.join(cwd, ".state");
  await login(cwd, stateDir);
  await writeLocalPin(cwd, projectId);
  return { cwd, stateDir };
}

async function readPinFile(cwd: string): Promise<string | null> {
  try {
    return await readFile(path.join(cwd, ".prisma/local.json"), "utf8");
  } catch {
    return null;
  }
}

describe("project remove", () => {
  it("requires exact project id confirmation", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["project", "remove", "Sandbox", "--confirm", "Sandbox", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload).toMatchObject({
      ok: false,
      command: "project.remove",
      error: {
        code: "CONFIRMATION_REQUIRED",
        domain: "project",
        meta: {
          expectedConfirm: "proj_999",
          receivedConfirm: "Sandbox",
        },
      },
    });
  });

  it("blocks removal while the project has deployments", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: [
        "project",
        "remove",
        "proj_123",
        "--confirm",
        "proj_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload).toMatchObject({
      ok: false,
      command: "project.remove",
      error: { code: "PROJECT_REMOVE_BLOCKED" },
    });
  });

  it("removes a project without deployments and keeps an unrelated pin", async () => {
    const { cwd, stateDir } = await setupLinkedProject("proj_123");

    const result = await executeCli({
      argv: [
        "project",
        "remove",
        "proj_999",
        "--confirm",
        "proj_999",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      ok: true,
      command: "project.remove",
      result: {
        project: { id: "proj_999", name: "Sandbox" },
        localPin: { cleared: false },
      },
    });
    expect(await readPinFile(cwd)).toContain("proj_123");
  });

  it("clears the local pin when it points at the removed project", async () => {
    const { cwd, stateDir } = await setupLinkedProject("proj_999");

    const result = await executeCli({
      argv: [
        "project",
        "remove",
        "proj_999",
        "--confirm",
        "proj_999",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.localPin).toMatchObject({ cleared: true });
    expect(await readPinFile(cwd)).toBeNull();
  });

  it("fails with PROJECT_NOT_FOUND for unknown targets", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["project", "remove", "nope", "--confirm", "nope", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).not.toBe(0);
    expect(payload.error.code).toBe("PROJECT_NOT_FOUND");
  });
});

describe("project transfer", () => {
  it("requires a recipient source", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: [
        "project",
        "transfer",
        "proj_123",
        "--confirm",
        "proj_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload.error.code).toBe("TRANSFER_RECIPIENT_REQUIRED");
  });

  it("rejects passing both recipient sources", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: [
        "project",
        "transfer",
        "proj_123",
        "--to-workspace",
        "ws_456",
        "--recipient-token",
        "tok",
        "--confirm",
        "proj_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload.error.code).toBe("USAGE_ERROR");
  });

  it("requires exact project id confirmation", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: [
        "project",
        "transfer",
        "proj_123",
        "--to-workspace",
        "ws_456",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: "CONFIRMATION_REQUIRED",
        domain: "project",
        meta: { expectedConfirm: "proj_123" },
      },
    });
  });

  it("transfers to a workspace and rewrites the matching local pin", async () => {
    const { cwd, stateDir } = await setupLinkedProject("proj_123");

    const result = await executeCli({
      argv: [
        "project",
        "transfer",
        "proj_123",
        "--to-workspace",
        "Prisma Labs",
        "--confirm",
        "proj_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      ok: true,
      command: "project.transfer",
      result: {
        project: { id: "proj_123" },
        recipient: {
          workspaceId: "ws_456",
          workspaceName: "Prisma Labs",
          source: "workspace-session",
        },
        localPin: { action: "rewritten" },
      },
    });
    const pin = await readPinFile(cwd);
    expect(pin).toContain("ws_456");
    expect(pin).toContain("proj_123");
  });

  it("transfers with a recipient token", async () => {
    const { cwd, stateDir } = await setupLinkedProject("proj_123");

    const result = await executeCli({
      argv: [
        "project",
        "transfer",
        "proj_123",
        "--recipient-token",
        "ws_456",
        "--confirm",
        "proj_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.recipient.source).toBe("recipient-token");
    expect(payload.result.localPin.action).toBe("rewritten");
  });

  it("fails when the target workspace is unknown", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: [
        "project",
        "transfer",
        "proj_123",
        "--to-workspace",
        "Nowhere Inc",
        "--confirm",
        "proj_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).not.toBe(0);
    expect(payload.error.code).toBe("WORKSPACE_NOT_AUTHENTICATED");
  });
});
