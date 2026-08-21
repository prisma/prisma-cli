/**
 * The post-login tip resolves after the credential is stored, so a
 * status scan that throws must yield no tip rather than a failed login.
 */
import { describe, expect, it, vi } from "vitest";

import { resolveAgentSetupTipCommand } from "../src/commands/auth/agent-setup-tip";
import { readSkillsStatus } from "../src/lib/skills/status";

vi.mock("../src/lib/skills/status", () => ({
  readSkillsStatus: vi.fn(),
}));

const mockedRead = vi.mocked(readSkillsStatus);

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
