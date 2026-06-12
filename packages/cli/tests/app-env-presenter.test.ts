import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";

import { renderEnvList, serializeEnvList } from "../src/presenters/app-env";
import { getCommandDescriptor } from "../src/shell/command-meta";
import type { EnvListResult } from "../src/types/app-env";
import { createTestCommandContext } from "./helpers";

describe("app env presenters", () => {
  it("renders and serializes inferred missing-branch targets", async () => {
    const { context } = await createTestCommandContext({});
    const result: EnvListResult = {
      projectId: "proj_123",
      scope: { kind: "role", role: "preview" },
      target: {
        source: "local-git",
        branchName: "feature/not-created",
        branchExists: false,
        envMap: "preview",
      },
      variables: [
        {
          id: "envvar_preview",
          key: "API_URL",
          scope: { kind: "role", role: "preview" },
          source: "preview",
          isManagedBySystem: false,
          updatedAt: "2026-05-08T10:00:00.000Z",
        },
      ],
    };

    const human = stripAnsi(
      renderEnvList(
        context,
        getCommandDescriptor("project.env.list"),
        result,
      ).join("\n"),
    );
    const json = serializeEnvList(result);

    expect(human).toContain("target:");
    expect(human).toContain(
      "branch:feature/not-created -> preview (not created yet)",
    );
    expect(json).toMatchObject({
      projectId: "proj_123",
      scope: { kind: "role", role: "preview" },
      target: {
        source: "local-git",
        branchName: "feature/not-created",
        branchExists: false,
        envMap: "preview",
      },
      context: {
        target: "branch:feature/not-created -> preview (not created yet)",
      },
    });
  });
});
