import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestCli } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeAppBuild } from "../src/lib/app/build";
import { SERVICE_COMMANDS, SERVICE_GROUPS } from "./v8-service-testkit";

vi.mock("../src/lib/app/build", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/app/build")>()),
  executeAppBuild: vi.fn(),
}));

function makeCli() {
  return createTestCli({
    commands: SERVICE_COMMANDS,
    groups: SERVICE_GROUPS,
    now: () => new Date(0),
  });
}

async function makeCwd(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "v8-service-build-"));
}

beforeEach(() => {
  vi.mocked(executeAppBuild).mockReset();
});

describe("prisma-v8 service build", () => {
  it("presents the artifact and emits build step and output events", async () => {
    vi.mocked(executeAppBuild).mockImplementation(async (options) => {
      options.io?.onOutput?.("compiling", "stdout");
      options.io?.onOutput?.("warning: slow", "stderr");
      return {
        artifact: {
          directory: "/tmp/artifact",
          entrypoint: "server.js",
        },
        buildType: "bun",
      };
    });
    const cwd = await makeCwd();

    const result = await makeCli().run(
      ["service", "build", "--build-type", "bun", "--entry", "server.ts"],
      { cwd, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      directory: "/tmp/artifact",
      entrypoint: "server.js",
      buildType: "bun",
    });
    expect(result.events).toContainEqual({
      kind: "step-started",
      step: "build",
    });
    expect(result.events).toContainEqual({
      kind: "step-finished",
      step: "build",
      outcome: "ok",
    });
    expect(result.events).toContainEqual({
      kind: "output",
      source: "build",
      channel: "data",
      line: "compiling",
    });
    expect(result.events).toContainEqual({
      kind: "output",
      source: "build",
      channel: "diagnostic",
      line: "warning: slow",
    });
    expect(vi.mocked(executeAppBuild).mock.calls[0]?.[0]).toMatchObject({
      appPath: cwd,
      buildType: "bun",
      entrypoint: "server.ts",
    });
  });

  it("declares no credential needs", async () => {
    expect(SERVICE_COMMANDS["service build"].needs.credentials).toBe(false);
  });

  it("settles a failed framework build as SERVICE.BUILD_FAILED with exit 2", async () => {
    vi.mocked(executeAppBuild).mockRejectedValue(new Error("tsc exploded"));
    const cwd = await makeCwd();

    const result = await makeCli().run(
      [
        "service",
        "build",
        "--build-type",
        "bun",
        "--entry",
        "server.ts",
        "--json",
      ],
      { cwd },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.BUILD_FAILED");
    expect(frame.envelope.error.summary).toBe("Local service build failed");
    expect(frame.envelope.error.why).toBe("tsc exploded");
    expect(result.events).toContainEqual({
      kind: "step-finished",
      step: "build",
      outcome: "failed",
    });
  });

  it("asks for an explicit framework when auto detection is ambiguous", async () => {
    vi.mocked(executeAppBuild).mockRejectedValue(
      new Error("Entrypoint is required. Pass --entry."),
    );
    const cwd = await makeCwd();

    const result = await makeCli().run(["service", "build", "--json"], { cwd });

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.BUILD_DETECTION_AMBIGUOUS");
  });

  it("rejects --entry with a framework that derives its own entrypoint", async () => {
    const cwd = await makeCwd();

    const result = await makeCli().run(
      [
        "service",
        "build",
        "--build-type",
        "nextjs",
        "--entry",
        "x.ts",
        "--json",
      ],
      { cwd },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.ENTRYPOINT_UNSUPPORTED");
    expect(executeAppBuild).not.toHaveBeenCalled();
  });

  it("rejects a named target without a compute config file", async () => {
    const cwd = await makeCwd();

    const result = await makeCli().run(["service", "build", "api", "--json"], {
      cwd,
    });

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe(
      "SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN",
    );
    expect(executeAppBuild).not.toHaveBeenCalled();
  });

  it("emits the completed json envelope with commandId service.build", async () => {
    vi.mocked(executeAppBuild).mockResolvedValue({
      artifact: { directory: "/tmp/artifact", entrypoint: "server.js" },
      buildType: "bun",
    });
    const cwd = await makeCwd();

    const result = await makeCli().run(
      [
        "service",
        "build",
        "--build-type",
        "bun",
        "--entry",
        "server.ts",
        "--json",
      ],
      { cwd },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.build");
    expect(frame.envelope.result).toEqual({
      directory: "/tmp/artifact",
      entrypoint: "server.js",
      buildType: "bun",
    });
  });

  it("rejects an unknown --build-type at parse time", async () => {
    const cwd = await makeCwd();

    const result = await makeCli().run(
      ["service", "build", "--build-type", "cobol"],
      { cwd, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(executeAppBuild).not.toHaveBeenCalled();
  });
});
