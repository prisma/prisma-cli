import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

async function setupLinkedProject() {
  const cwd = await createTempCwd();
  const stateDir = path.join(cwd, ".state");
  await executeCli({
    argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
    cwd,
    stateDir,
    fixturePath,
  });
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(
    path.join(cwd, ".prisma/local.json"),
    `${JSON.stringify({ workspaceId: "ws_123", projectId: "proj_123" }, null, 2)}\n`,
    "utf8",
  );
  return { cwd, stateDir };
}

describe("branch remove", () => {
  it("requires exact branch id confirmation", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["branch", "remove", "staging", "--confirm", "staging", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload).toMatchObject({
      ok: false,
      command: "branch.remove",
      error: {
        code: "CONFIRMATION_REQUIRED",
        domain: "branch",
        meta: {
          expectedConfirm: "br_345",
          receivedConfirm: "staging",
        },
      },
    });
    expect(payload.nextSteps[0]).toContain("branch remove br_345");
  });

  it("removes an empty preview branch by git name", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["branch", "remove", "staging", "--confirm", "br_345", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      ok: true,
      command: "branch.remove",
      result: {
        projectId: "proj_123",
        branch: { id: "br_345", name: "staging", role: "preview" },
      },
    });
    expect(payload.result).not.toHaveProperty("removed");
  });

  it("refuses production branches with BRANCH_PROTECTED", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["branch", "remove", "production", "--confirm", "br_456", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload.error.code).toBe("BRANCH_PROTECTED");
  });

  it("refuses default branches with BRANCH_PROTECTED even when role is preview", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const raw = JSON.parse(await readFile(fixturePath, "utf8")) as {
      branches: Array<Record<string, unknown>>;
    };
    raw.branches.push({
      id: "br_567",
      projectId: "proj_123",
      name: "legacy-default",
      role: "preview",
      isDefault: true,
      currentDeploymentId: null,
    });
    const defaultBranchFixturePath = path.join(
      cwd,
      "default-branch-fixture.json",
    );
    await writeFile(
      defaultBranchFixturePath,
      `${JSON.stringify(raw, null, 2)}\n`,
      "utf8",
    );

    const result = await executeCli({
      argv: [
        "branch",
        "remove",
        "legacy-default",
        "--confirm",
        "br_567",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath: defaultBranchFixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload.error.code).toBe("BRANCH_PROTECTED");
  });

  it("refuses branches that still have live resources", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    // br_123 "preview" has a database and deployments attached in the fixture.
    const result = await executeCli({
      argv: ["branch", "remove", "br_123", "--confirm", "br_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload.error.code).toBe("BRANCH_NOT_EMPTY");
    expect(payload.nextSteps.join(" ")).toContain("database list --branch");
  });

  it("fails with BRANCH_NOT_FOUND for unknown branches", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["branch", "remove", "nope", "--confirm", "nope", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload.error.code).toBe("BRANCH_NOT_FOUND");
  });

  it("resolves an explicit --project", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await executeCli({
      argv: [
        "branch",
        "remove",
        "staging",
        "--project",
        "proj_123",
        "--confirm",
        "br_345",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.branch.id).toBe("br_345");
  });
});

describe("branch remove --cascade", () => {
  it("offers the cascade rerun in the BRANCH_NOT_EMPTY recovery steps", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: ["branch", "remove", "br_123", "--confirm", "br_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload.error.code).toBe("BRANCH_NOT_EMPTY");
    expect(payload.nextSteps[0]).toContain("--cascade");
    expect(payload.nextSteps.join(" ")).toContain(
      "app remove --app <name> --branch preview",
    );
  });

  it("removes the branch and its resources with --cascade and lists them", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: [
        "branch",
        "remove",
        "preview",
        "--confirm",
        "br_123",
        "--cascade",
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
      command: "branch.remove",
      result: {
        branch: { id: "br_123", name: "preview" },
        removed: {
          databases: [{ id: "db_123", name: "acme-preview" }],
        },
      },
    });
    expect(payload.result.removed.apps.length).toBeGreaterThan(0);
  });

  it("still refuses production branches with --cascade", async () => {
    const { cwd, stateDir } = await setupLinkedProject();

    const result = await executeCli({
      argv: [
        "branch",
        "remove",
        "production",
        "--confirm",
        "br_456",
        "--cascade",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload.error.code).toBe("BRANCH_PROTECTED");
  });
});
