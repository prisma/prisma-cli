/** Read-only happy paths for the project and auth commands. */
import { expect, it } from "vitest";

import { useScratchProject } from "./scratch";
import { describeCommand, session } from "./suite";

interface ListResult {
  readonly items: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly count: number;
}

const PROJECT_ID = /^proj_/;

/** The list is checked against a project this run created, rather than
 *  against whatever the workspace happens to contain. An assertion that
 *  needs the workspace pre-populated fails for the wrong reason the day
 *  someone empties it, and passing it a project it must contain is the
 *  stronger check anyway. */
const scratch = useScratchProject("read");

describeCommand("project list", () => {
  it("lists the workspace's projects, including one just created", async () => {
    const run = await scratch.run(["project", "list"]);
    const result = run.envelope.result as ListResult;

    expect(run.exitCode).toBe(0);
    // The defect this suite exists for: a workspace-id format mismatch
    // filtered every project away and still reported success. Requiring
    // the new project to appear catches that, and catches any later
    // filter that empties a non-empty response.
    expect(result.items.map((item) => item.id)).toContain(scratch.project().id);
    expect(result.count).toBe(result.items.length);
    for (const project of result.items) {
      expect(project.id).toMatch(PROJECT_ID);
      expect(project.name).toBeTruthy();
    }
  });
});

describeCommand("project show", () => {
  it("shows a project resolved by id", async () => {
    const target = scratch.project();

    const run = await scratch.run(["project", "show", "--project", target.id]);
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
