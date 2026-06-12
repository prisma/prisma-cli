import { describe, expect, it } from "vitest";

import { CliError } from "../src/shell/errors";
import { writeHumanError } from "../src/shell/output";
import { renderDeployOutputRows } from "../src/lib/app/deploy-output";
import { plain } from "../src/shell/ui";
import { createTempCwd, createTestCommandContext } from "./helpers";

describe("shell output", () => {
  it("aligns deploy output rows and dims origins when color is enabled", async () => {
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({
      cwd,
      isTTY: true,
      flags: { color: true },
    });

    const lines = renderDeployOutputRows(context.ui, [
      { label: "Workspace", value: "Edith" },
      { label: "Project", value: "j1", origin: "created from package.json" },
      { label: "Runtime", value: "HTTP 3000", origin: "Next.js default" },
      { label: "Uploaded" },
    ]);

    expect(plain(lines.join("\n"))).toBe(
      [
        "  Workspace  Edith",
        "  Project    j1         · created from package.json",
        "  Runtime    HTTP 3000  · Next.js default",
        "  Uploaded",
      ].join("\n"),
    );
    expect(lines[1]).toContain("\u001B[1m");
    expect(lines[1]).toContain(
      "\u001B[2m· created from package.json\u001B[22m",
    );
  });

  it("falls back to standard error formatting when humanLines is empty", async () => {
    const cwd = await createTempCwd();
    const { context, stderr } = await createTestCommandContext({ cwd });

    const error = new CliError({
      code: "DEPLOY_FAILED",
      domain: "app",
      summary: "App deploy failed",
      why: "Upload failed",
      fix: "Retry the command.",
      humanLines: [],
    });

    expect(error.humanLines).toBeNull();

    writeHumanError(context.output, context.ui, error, { trace: false });

    expect(stderr.buffer).toContain("App deploy failed [DEPLOY_FAILED]");
    expect(stderr.buffer).toContain("Why: Upload failed");
  });

  it("clones custom human error lines before rendering", async () => {
    const cwd = await createTempCwd();
    const { context, stderr } = await createTestCommandContext({ cwd });
    const humanLines = ["Custom failure."];

    const error = new CliError({
      code: "DEPLOY_FAILED",
      domain: "app",
      summary: "App deploy failed",
      why: "Upload failed",
      fix: "Retry the command.",
      humanLines,
    });
    humanLines.push("Mutated after construction.");

    writeHumanError(context.output, context.ui, error, { trace: false });

    expect(stderr.buffer).toContain("Custom failure.");
    expect(stderr.buffer).not.toContain("Mutated after construction.");
  });

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
        debug:
          "Error: ENOENT: missing file\n    at stageNextjsStandaloneArtifact",
      }),
      { trace: true },
    );

    expect(stderr.buffer).toContain("Trace:");
    expect(stderr.buffer).toContain("Error: ENOENT: missing file");
    expect(stderr.buffer).toContain("stageNextjsStandaloneArtifact");
    expect(stderr.buffer).not.toContain("More: Re-run with --trace");
  });
});
