/**
 * The agent commands install and report Prisma's skills for local
 * coding agents. They touch no management API — they run the `skills`
 * CLI and write files into the working directory — but they ship in the
 * binary, so they get the same real happy path as everything else.
 *
 * Each runs in a throwaway working directory, so the files they write
 * belong to the run and go with it.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { beforeAll, expect, it } from "vitest";

import { describeCommand, session } from "./suite";

interface StatusResult {
  readonly skillsInstalled: boolean;
  readonly skillsLockInstalled: boolean;
  readonly skillsLockPath: string;
  readonly statusScope: string;
}

interface OperationResult {
  readonly operation: string;
  readonly skills: { readonly status: string };
}

/** Shared so `status` can be asked before and after `install`, which is
 *  what shows the install did something. */
let workdir: string;
let installedBefore: StatusResult | undefined;

beforeAll(async () => {
  const cli = await session();
  workdir = await cli.workdir();
  installedBefore = (await cli.run(["agent", "status"], { cwd: workdir }))
    .envelope.result as StatusResult;
});

describeCommand("agent status", () => {
  it("reports nothing installed in a fresh directory", async () => {
    expect(installedBefore?.statusScope).toBe("project");
    expect(installedBefore?.skillsInstalled).toBe(false);
    expect(installedBefore?.skillsLockInstalled).toBe(false);
    expect(installedBefore?.skillsLockPath).toBe("skills-lock.json");
  });
});

describeCommand("agent install", () => {
  it("installs the skills and writes the lock file", async () => {
    const cli = await session();
    const run = await cli.run(["agent", "install"], { cwd: workdir });
    const result = run.envelope.result as OperationResult;

    expect(result.operation).toBe("install");
    expect(result.skills.status).toBe("installed");
    // The command's own answer is not the whole story: the lock file it
    // claims to write has to be there.
    expect(existsSync(path.join(workdir, "skills-lock.json"))).toBe(true);

    const after = (await cli.run(["agent", "status"], { cwd: workdir }))
      .envelope.result as StatusResult;
    expect(after.skillsLockInstalled).toBe(true);
    expect(after.skillsInstalled).toBe(true);
  });
});

describeCommand("agent update", () => {
  it("updates the skills already installed", async () => {
    const cli = await session();
    // Its own directory and its own install: depending on the block
    // above would make this pass or fail on test order, and a focused
    // run would find an empty directory.
    const cwd = await cli.workdir();
    await cli.run(["agent", "install"], { cwd });

    const run = await cli.run(["agent", "update"], { cwd });
    const result = run.envelope.result as OperationResult;

    expect(result.operation).toBe("update");
    expect(result.skills.status).toBe("installed");
    expect(existsSync(path.join(cwd, "skills-lock.json"))).toBe(true);
  });
});
