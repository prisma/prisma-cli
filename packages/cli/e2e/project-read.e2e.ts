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
  it("shows a project resolved by id, and says how it resolved it", async () => {
    const target = scratch.project();

    const run = await scratch.run(["project", "show", target.id]);
    const shown = run.envelope.result as {
      readonly project: { readonly id: string; readonly name: string };
      readonly resolution: { readonly projectSource: string };
    };

    expect(shown.project.id).toBe(target.id);
    expect(shown.project.name).toBe(target.name);
    expect(shown.resolution.projectSource).toBe("explicit");
  });
});

describeCommand("auth whoami", () => {
  /** `whoami` answers ok whether or not it found a credential — running
   *  it with none returns `{authenticated: false}` and exit 0. Asserting
   *  only `ok` therefore passes on a completely unauthenticated CLI,
   *  which is the one thing this test exists to rule out. */
  it("reports the workspace it is authenticated as", async () => {
    const cli = await session();
    const run = await cli.run(["auth", "whoami"]);
    const who = run.envelope.result as {
      readonly authenticated: boolean;
      readonly workspace: { readonly id: string } | null;
      readonly source: string | null;
    };

    expect(run.exitCode).toBe(0);
    expect(who.authenticated).toBe(true);
    expect(who.workspace?.id).toBeTruthy();
    // The suite authenticates through PRISMA_SERVICE_TOKEN, so anything
    // else means the run picked up a credential it was not given.
    expect(who.source).toBe("environment");
  });
});

describeCommand("auth workspace list", () => {
  it("reports the environment credential as the one in force", async () => {
    const cli = await session();
    const run = await cli.run(["auth", "workspace", "list"]);
    const listed = run.envelope.result as {
      readonly context: { readonly environmentCredentialInForce: boolean };
      readonly items: readonly unknown[];
      readonly count: number;
    };

    expect(run.exitCode).toBe(0);
    expect(listed.context.environmentCredentialInForce).toBe(true);
    expect(listed.count).toBe(listed.items.length);
  });
});

describeCommand("auth logout", () => {
  it("ends no stored session, and leaves the env credential working", async () => {
    const cli = await session();
    const cwd = await cli.workdir();

    const run = await cli.run(["auth", "logout"], { cwd });
    const result = run.envelope.result as {
      readonly endedCount: number;
      readonly workspaceIds: readonly string[];
    };

    // A service-token host holds no stored sessions, so there is nothing
    // to end. Checking the count rather than just `ok` is what shows
    // logout left the environment credential alone.
    expect(result.endedCount).toBe(0);
    expect(result.workspaceIds).toEqual([]);

    const after = await cli.run(["project", "list"], { cwd });
    expect(after.envelope.ok).toBe(true);
  });
});
