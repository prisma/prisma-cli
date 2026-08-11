/**
 * The project lifecycle against the real API: create, link, rename,
 * environment variables, branches, then remove.
 *
 * These share one scratch project, so the `it` blocks run in order and
 * depend on each other. Vitest runs them sequentially within a file.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, it } from "vitest";

import { scratchName } from "./harness";
import { useScratchProject } from "./scratch";
import { describeCommand, session } from "./suite";

const scratch = useScratchProject("lifecycle");

const PROJECT_ID = /^proj_/;
const SCRATCH_LIFECYCLE_NAME = /^e2e-lifecycle-/;

describeCommand("project create", () => {
  it("created the scratch project and wrote its local pin", async () => {
    const project = scratch.project();

    expect(project.id).toMatch(PROJECT_ID);
    expect(project.name).toMatch(SCRATCH_LIFECYCLE_NAME);

    const pin = JSON.parse(
      await readFile(path.join(project.cwd, ".prisma", "local.json"), "utf8"),
    ) as { readonly projectId: string; readonly workspaceId: string };
    expect(pin.projectId).toBe(project.id);
    expect(pin.workspaceId).toBeTruthy();
  });
});

describeCommand("project link", () => {
  it("links a fresh directory to the scratch project", async () => {
    const cli = await session();
    const cwd = await cli.workdir();

    const run = await cli.run(["project", "link", scratch.project().id], {
      cwd,
    });
    const linked = run.envelope.result as {
      readonly project: { readonly id: string };
    };

    expect(linked.project.id).toBe(scratch.project().id);

    const pin = JSON.parse(
      await readFile(path.join(cwd, ".prisma", "local.json"), "utf8"),
    ) as { readonly projectId: string };
    expect(pin.projectId).toBe(scratch.project().id);
  });
});

describeCommand("project rename", () => {
  it("renames the scratch project", async () => {
    const renamed = scratchName("renamed");

    const run = await scratch.run(["project", "rename", renamed]);
    const result = run.envelope.result as {
      readonly project: { readonly name: string };
    };

    expect(result.project.name).toBe(renamed);
  });
});

describeCommand("branch list", () => {
  it("lists the branches of the linked project", async () => {
    const run = await scratch.run(["branch", "list"]);

    expect(run.exitCode).toBe(0);
    expect(run.envelope.ok).toBe(true);
  });
});

/** Environment variables are scoped to a role or a branch, and the
 *  commands refuse to guess which. */
const ROLE = ["--role", "production"] as const;

describeCommand("project env add", () => {
  it("adds an environment variable", async () => {
    const run = await scratch.run([
      "project",
      "env",
      "add",
      "E2E_SAMPLE=first",
      ...ROLE,
    ]);

    expect(run.envelope.ok).toBe(true);
  });
});

describeCommand("project env list", () => {
  it("lists the variable that was just added", async () => {
    const run = await scratch.run(["project", "env", "list", ...ROLE]);

    expect(run.envelope.ok).toBe(true);
    expect(JSON.stringify(run.envelope.result)).toContain("E2E_SAMPLE");
  });
});

describeCommand("project env update", () => {
  it("updates the variable's value", async () => {
    const run = await scratch.run([
      "project",
      "env",
      "update",
      "E2E_SAMPLE=second",
      ...ROLE,
    ]);

    expect(run.envelope.ok).toBe(true);
  });
});

describeCommand("project env remove", () => {
  it("removes the variable", async () => {
    const run = await scratch.run([
      "project",
      "env",
      "remove",
      "E2E_SAMPLE",
      ...ROLE,
      "--confirm",
      "E2E_SAMPLE",
    ]);

    expect(run.envelope.ok).toBe(true);

    const after = await scratch.run(["project", "env", "list", ...ROLE]);
    expect(JSON.stringify(after.envelope.result)).not.toContain("E2E_SAMPLE");
  });
});

describeCommand("project remove", () => {
  it("removes a project it created for the purpose", async () => {
    const cli = await session();
    const cwd = await cli.workdir();
    const name = scratchName("removable");

    const created = (await cli.run(["project", "create", name], { cwd }))
      .envelope.result as { readonly project: { readonly id: string } };
    const id = created.project.id;

    const run = await cli.run(["project", "remove", id, "--confirm", id], {
      cwd,
    });
    expect(run.envelope.ok).toBe(true);

    const remaining = (await cli.run(["project", "list"], { cwd })).envelope
      .result as {
      readonly items: ReadonlyArray<{ readonly id: string }>;
    };
    expect(remaining.items.map((item) => item.id)).not.toContain(id);
  });
});
