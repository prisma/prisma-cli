/** Read-only happy paths for the project commands. */
import { expect, it } from "vitest";

import { describeCommand, session } from "./suite";

interface ListResult {
  readonly items: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly count: number;
}

const PROJECT_ID = /^proj_/;

async function listProjects(): Promise<ListResult> {
  const cli = await session();
  return (await cli.run(["project", "list"])).envelope.result as ListResult;
}

describeCommand("project list", () => {
  it("lists the workspace's projects", async () => {
    const cli = await session();
    const run = await cli.run(["project", "list"]);
    const result = run.envelope.result as ListResult;

    expect(run.exitCode).toBe(0);
    // The defect this suite exists for: a workspace-id format mismatch
    // filtered every project away and still reported success. An empty
    // list is indistinguishable from that failure, so the e2e workspace
    // must hold at least one project.
    expect(result.count).toBeGreaterThan(0);
    expect(result.items.length).toBe(result.count);
    for (const project of result.items) {
      expect(project.id).toMatch(PROJECT_ID);
      expect(project.name).toBeTruthy();
    }
  });
});

describeCommand("project show", () => {
  it("shows a project resolved by id", async () => {
    const listed = await listProjects();
    const target = listed.items[0];
    if (target === undefined)
      throw new Error("the e2e workspace has no project");

    const cli = await session();
    const run = await cli.run(["project", "show", "--project", target.id]);
    const shown = run.envelope.result as {
      readonly project: { readonly id: string; readonly name: string };
    };

    expect(shown.project.id).toBe(target.id);
    expect(shown.project.name).toBe(target.name);
  });
});

describeCommand("auth whoami", () => {
  it("reports the authenticated workspace", async () => {
    const cli = await session();
    const run = await cli.run(["auth", "whoami"]);

    expect(run.exitCode).toBe(0);
    expect(run.envelope.ok).toBe(true);
  });
});

describeCommand("auth workspace list", () => {
  it("lists the sessions this host can see", async () => {
    const cli = await session();
    const run = await cli.run(["auth", "workspace", "list"]);

    expect(run.exitCode).toBe(0);
    expect(run.envelope.ok).toBe(true);
  });
});

describeCommand("auth logout", () => {
  it("clears local sessions without disturbing the env credential", async () => {
    const cli = await session();
    const cwd = await cli.workdir();

    const run = await cli.run(["auth", "logout"], { cwd });
    expect(run.envelope.ok).toBe(true);

    // The service token lives in the environment, not in the session
    // store, so the CLI must still be authenticated afterwards.
    const after = await cli.run(["project", "list"], { cwd });
    expect(after.envelope.ok).toBe(true);
  });
});
