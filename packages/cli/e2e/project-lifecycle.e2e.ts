/**
 * The project lifecycle against the real API: create, link, rename,
 * environment variables, branches, then delete.
 *
 * These share one scratch project, so the `it` blocks run in order and
 * depend on each other. Vitest runs them sequentially within a file.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, it } from "vitest";

import { scratchName } from "./harness";
import { removeScratchProject, useScratchProject } from "./scratch";
import { describeCommand, session } from "./suite";

const scratch = useScratchProject("lifecycle");

const PROJECT_ID = /^proj_/;
const SCRATCH_LIFECYCLE_NAME = /^e2e-lifecycle-/;
const BRANCH_ID = /^br_/;
const ENV_VARIABLE_ID = /^envvar_/;

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
  it("renames the scratch project and reports the previous name", async () => {
    const before = scratch.project().name;
    const renamed = scratchName("renamed");

    const run = await scratch.run(["project", "rename", renamed]);
    const result = run.envelope.result as {
      readonly project: { readonly id: string; readonly name: string };
      readonly previousName: string;
    };

    expect(result.project.id).toBe(scratch.project().id);
    expect(result.project.name).toBe(renamed);
    expect(result.previousName).toBe(before);
  });
});

describeCommand("branch list", () => {
  it("lists the linked project's branches", async () => {
    const run = await scratch.run(["branch", "list"]);
    const result = run.envelope.result as {
      readonly projectId: string;
      readonly branches: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly role: string;
      }>;
    };

    expect(run.exitCode).toBe(0);
    expect(result.projectId).toBe(scratch.project().id);
    // A new project always has its production branch, so an empty list
    // here is the same silently-emptied response this suite exists for.
    expect(result.branches.length).toBeGreaterThan(0);
    expect(result.branches.map((branch) => branch.role)).toContain(
      "production",
    );
    for (const branch of result.branches) {
      expect(branch.id).toMatch(BRANCH_ID);
      expect(branch.name).toBeTruthy();
    }
  });
});

/** Environment variables are scoped to a role or a branch, and the
 *  commands refuse to guess which. */
const ROLE = ["--role", "production"] as const;
const KEY = "E2E_SAMPLE";

interface EnvVariable {
  readonly id: string;
  readonly key: string;
  readonly updatedAt: string;
}

interface EnvMutationResult {
  readonly projectId: string;
  readonly scope: { readonly kind: string; readonly role?: string };
  readonly variable: EnvVariable;
}

/** List results carry both a generic `items`/`count` pair for rendering
 *  and the domain array the assertions want. */
interface EnvListResult {
  readonly projectId: string;
  readonly variables: readonly EnvVariable[];
  readonly items: readonly unknown[];
  readonly count: number;
}

/** Carried from `add` to `update`, so the update can be shown to have
 *  changed the variable rather than merely returned a success. */
let addedAt: string | undefined;

describeCommand("project env add", () => {
  it("adds an environment variable in the production scope", async () => {
    const run = await scratch.run([
      "project",
      "env",
      "add",
      `${KEY}=first`,
      ...ROLE,
    ]);
    const result = run.envelope.result as EnvMutationResult;

    expect(result.projectId).toBe(scratch.project().id);
    expect(result.variable.key).toBe(KEY);
    expect(result.variable.id).toMatch(ENV_VARIABLE_ID);
    expect(result.scope).toMatchObject({ kind: "role", role: "production" });
    addedAt = result.variable.updatedAt;
  });
});

describeCommand("project env list", () => {
  it("lists the variable that was just added", async () => {
    const run = await scratch.run(["project", "env", "list", ...ROLE]);
    const listed = run.envelope.result as EnvListResult;

    expect(listed.projectId).toBe(scratch.project().id);
    expect(listed.variables.map((row) => row.key)).toContain(KEY);
    expect(listed.count).toBe(listed.items.length);
  });
});

describeCommand("project env update", () => {
  it("updates the variable in place", async () => {
    const run = await scratch.run([
      "project",
      "env",
      "update",
      `${KEY}=second`,
      ...ROLE,
    ]);
    const result = run.envelope.result as EnvMutationResult;

    expect(result.variable.key).toBe(KEY);
    // Same variable, not a replacement, and actually touched: the API
    // returns the same id with a later timestamp. Without this the test
    // passed on any successful response at all.
    expect(result.variable.updatedAt).not.toBe(addedAt);
    expect(Date.parse(result.variable.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(addedAt ?? result.variable.updatedAt),
    );
  });
});

describeCommand("project env delete", () => {
  it("deletes the variable, and the list agrees", async () => {
    const run = await scratch.run([
      "project",
      "env",
      "delete",
      KEY,
      ...ROLE,
      "--confirm",
      KEY,
    ]);
    const deleted = run.envelope.result as {
      readonly projectId: string;
      readonly key: string;
    };

    expect(deleted.projectId).toBe(scratch.project().id);
    expect(deleted.key).toBe(KEY);

    const after = await scratch.run(["project", "env", "list", ...ROLE]);
    const listed = after.envelope.result as EnvListResult;
    expect(listed.variables.map((row) => row.key)).not.toContain(KEY);
  });
});

describeCommand("project delete", () => {
  it("deletes a project it created for the purpose", async () => {
    const cli = await session();
    const cwd = await cli.workdir();
    const name = scratchName("removable");

    const created = (await cli.run(["project", "create", name], { cwd }))
      .envelope.result as { readonly project: { readonly id: string } };
    const id = created.project.id;

    // This project is created outside useScratchProject, so nothing else
    // will clean it up. Without the finally, an assertion failing between
    // here and the deletion leaves it in the real workspace for good.
    let deleted = false;
    try {
      const run = await cli.run(["project", "delete", id, "--confirm", id], {
        cwd,
      });
      const result = run.envelope.result as {
        readonly project: { readonly id: string };
        readonly localPin: { readonly cleared: boolean };
      };
      expect(result.project.id).toBe(id);
      // Deleting the project must also drop this directory's binding,
      // or the next command here resolves a project that is gone.
      expect(result.localPin.cleared).toBe(true);
      deleted = true;

      const remaining = (await cli.run(["project", "list"], { cwd })).envelope
        .result as {
        readonly items: ReadonlyArray<{ readonly id: string }>;
      };
      expect(remaining.items.map((item) => item.id)).not.toContain(id);
    } finally {
      if (!deleted) {
        await removeScratchProject(cli, { id, name, cwd });
      }
    }
  });
});
