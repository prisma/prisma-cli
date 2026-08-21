/**
 * The post-login tip resolves after the credential is stored, so a
 * status scan that throws must yield no tip rather than a failed login.
 */
import { describe, expect, it, vi } from "vitest";

import { resolveAgentSetupTipCommand } from "../src/commands/auth/agent-setup-tip";
import { resolvePrismaCliPackageCommand } from "../src/lib/agent/cli-command";
import { readSkillsStatus } from "../src/lib/skills/status";

vi.mock("../src/lib/skills/status", () => ({
  readSkillsStatus: vi.fn(),
}));
vi.mock("../src/lib/agent/cli-command", () => ({
  resolvePrismaCliPackageCommand: vi.fn(),
}));

const mockedRead = vi.mocked(readSkillsStatus);
const mockedResolve = vi.mocked(resolvePrismaCliPackageCommand);

function tipContext(cwd: string) {
  return { cwd, env: {}, signal: new AbortController().signal };
}

describe("resolveAgentSetupTipCommand", () => {
  it("returns null when the status scan throws", async () => {
    mockedRead.mockRejectedValueOnce(new Error("unreadable project"));

    await expect(
      resolveAgentSetupTipCommand(tipContext("/nowhere")),
    ).resolves.toBeNull();
  });

  it("returns null when the command resolver throws", async () => {
    mockedRead.mockResolvedValueOnce({
      projectRoot: "/project",
      checkDisabled: false,
      packages: [
        {
          name: "@prisma/orm-postgres",
          version: "8.1.0",
          dir: "/project/node_modules/@prisma/orm-postgres",
          conflictingVersions: [],
        },
      ],
      skills: [],
      orphans: [],
      upToDate: false,
    });
    mockedResolve.mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      }),
    );

    await expect(
      resolveAgentSetupTipCommand(tipContext("/project")),
    ).resolves.toBeNull();
    expect(mockedResolve).toHaveBeenCalled();
  });

  it("skips the orphan scan it never reads", async () => {
    mockedRead.mockResolvedValueOnce({
      projectRoot: "/project",
      checkDisabled: false,
      packages: [],
      skills: [],
      orphans: [],
      upToDate: true,
    });

    await expect(
      resolveAgentSetupTipCommand(tipContext("/project")),
    ).resolves.toBeNull();
    expect(mockedRead).toHaveBeenCalledWith("/project", { orphans: false });
  });
});
