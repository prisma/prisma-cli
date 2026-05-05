import { describe, expect, it } from "vitest";

import { CliError } from "../src/shell/errors";
import { writeHumanError } from "../src/shell/output";
import { createTempCwd, createTestCommandContext } from "./helpers";

describe("shell output", () => {
  it("renders debug details when --trace is enabled", async () => {
    const cwd = await createTempCwd();
    const { context, stderr } = await createTestCommandContext({
      cwd,
      flags: { trace: true },
    });

    writeHumanError(
      context.output,
      context.ui,
      new CliError({
        code: "DEPLOY_FAILED",
        domain: "app",
        summary: "App deploy failed",
        why: "ENOENT: missing file",
        fix: "Retry the command.",
        debug: "Error: ENOENT: missing file\n    at stageNextjsStandaloneArtifact",
      }),
      { trace: true },
    );

    expect(stderr.buffer).toContain("Trace:");
    expect(stderr.buffer).toContain("Error: ENOENT: missing file");
    expect(stderr.buffer).toContain("stageNextjsStandaloneArtifact");
    expect(stderr.buffer).not.toContain("More: Re-run with --trace");
  });
});
