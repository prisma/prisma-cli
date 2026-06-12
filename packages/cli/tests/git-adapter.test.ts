import { describe, expect, it } from "vitest";

import {
  parseGitHubRepositoryUrl,
  readGitOriginRemote,
} from "../src/adapters/git";

describe("git adapter", () => {
  it("parses supported GitHub repository URLs", () => {
    expect(
      parseGitHubRepositoryUrl("https://github.com/prisma/prisma-cli"),
    ).toEqual({
      provider: "github",
      owner: "prisma",
      name: "prisma-cli",
      fullName: "prisma/prisma-cli",
      url: "https://github.com/prisma/prisma-cli",
    });
    expect(
      parseGitHubRepositoryUrl("https://github.com/prisma/prisma-cli.git"),
    ).toEqual({
      provider: "github",
      owner: "prisma",
      name: "prisma-cli",
      fullName: "prisma/prisma-cli",
      url: "https://github.com/prisma/prisma-cli",
    });
    expect(
      parseGitHubRepositoryUrl("git@github.com:prisma/prisma-cli.git"),
    ).toEqual({
      provider: "github",
      owner: "prisma",
      name: "prisma-cli",
      fullName: "prisma/prisma-cli",
      url: "https://github.com/prisma/prisma-cli",
    });
    expect(
      parseGitHubRepositoryUrl("ssh://git@github.com/prisma/prisma-cli.git"),
    ).toEqual({
      provider: "github",
      owner: "prisma",
      name: "prisma-cli",
      fullName: "prisma/prisma-cli",
      url: "https://github.com/prisma/prisma-cli",
    });
  });

  it("rejects unsupported providers and non-repository GitHub URLs", () => {
    expect(
      parseGitHubRepositoryUrl("https://gitlab.com/prisma/prisma-cli"),
    ).toBeNull();
    expect(
      parseGitHubRepositoryUrl("https://github.com/prisma/prisma-cli/issues"),
    ).toBeNull();
    expect(parseGitHubRepositoryUrl("not a url")).toBeNull();
  });

  it("preserves cancellation while reading the origin remote", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      readGitOriginRemote(process.cwd(), controller.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
