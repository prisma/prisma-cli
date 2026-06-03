import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/lib/app/local-dev");
  vi.doUnmock("../src/lib/app/preview-build");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("app local dev commands", () => {
  it("build delegates to the shared preview build helper", async () => {
    const executePreviewBuild = vi.fn().mockResolvedValue({
      artifact: {
        directory: "/tmp/compute-build/app",
        entrypoint: "server.js",
      },
      buildType: "bun",
    });

    vi.doMock("../src/lib/app/preview-build", async () => {
      const actual = await vi.importActual<typeof import("../src/lib/app/preview-build")>(
        "../src/lib/app/preview-build",
      );
      return {
        ...actual,
        executePreviewBuild,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppBuild } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    const result = await runAppBuild(context, "server.ts", "bun");

    expect(executePreviewBuild).toHaveBeenCalledWith({
      appPath: cwd,
      entrypoint: "server.ts",
      buildType: "bun",
      signal: context.runtime.signal,
    });
    expect(result.result).toEqual({
      directory: "/tmp/compute-build/app",
      entrypoint: "server.js",
      buildType: "bun",
    });
  });

  it("build accepts explicit SDK framework strategies", async () => {
    const executePreviewBuild = vi.fn().mockResolvedValue({
      artifact: {
        directory: "/tmp/compute-build/app",
        entrypoint: "server/entry.mjs",
      },
      buildType: "astro",
    });

    vi.doMock("../src/lib/app/preview-build", async () => {
      const actual = await vi.importActual<typeof import("../src/lib/app/preview-build")>(
        "../src/lib/app/preview-build",
      );
      return {
        ...actual,
        executePreviewBuild,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppBuild } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    const result = await runAppBuild(context, undefined, "astro");

    expect(executePreviewBuild).toHaveBeenCalledWith({
      appPath: cwd,
      entrypoint: undefined,
      buildType: "astro",
      signal: context.runtime.signal,
    });
    expect(result.result).toEqual({
      directory: "/tmp/compute-build/app",
      entrypoint: "server/entry.mjs",
      buildType: "astro",
    });
  });

  it("build returns USAGE_ERROR when framework detection is ambiguous", async () => {
    const executePreviewBuild = vi.fn().mockRejectedValue(
      new Error("Entrypoint is required. Pass --entry or define package.json main or module."),
    );

    vi.doMock("../src/lib/app/preview-build", async () => {
      const actual = await vi.importActual<typeof import("../src/lib/app/preview-build")>(
        "../src/lib/app/preview-build",
      );
      return {
        ...actual,
        executePreviewBuild,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppBuild } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    await expect(runAppBuild(context, undefined, "auto")).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "App build requires an explicit framework when detection is ambiguous",
    });
  });

  it("run returns USAGE_ERROR for --json", async () => {
    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRun } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      flags: {
        json: true,
      },
    });

    await expect(runAppRun(context, undefined, "auto", undefined)).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "App run does not support --json",
    });
  });

  it("run returns USAGE_ERROR when framework detection is ambiguous", async () => {
    const resolveLocalBuildType = vi.fn().mockResolvedValue(null);

    vi.doMock("../src/lib/app/local-dev", async () => {
      const actual = await vi.importActual<typeof import("../src/lib/app/local-dev")>(
        "../src/lib/app/local-dev",
      );
      return {
        ...actual,
        resolveLocalBuildType,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRun } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    await expect(runAppRun(context, undefined, "auto", undefined)).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "App run requires an explicit framework when detection is ambiguous",
    });
  });

  it("run rejects --entry together with --build-type nextjs", async () => {
    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRun } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    await expect(runAppRun(context, "server.ts", "nextjs", undefined)).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "App run does not accept --entry with --build-type nextjs",
    });
  });

  it("run delegates to the local framework runner", async () => {
    const runLocalApp = vi.fn().mockResolvedValue({
      framework: "bun",
      entrypoint: "server.ts",
      port: 4000,
      command: "bun --watch server.ts",
      exitCode: 0,
      signal: null,
    });

    vi.doMock("../src/lib/app/local-dev", async () => {
      const actual = await vi.importActual<typeof import("../src/lib/app/local-dev")>(
        "../src/lib/app/local-dev",
      );
      return {
        ...actual,
        runLocalApp,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRun } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    const result = await runAppRun(context, "server.ts", "bun", "4000");

    expect(runLocalApp).toHaveBeenCalledWith({
      appPath: cwd,
      buildType: "bun",
      entrypoint: "server.ts",
      port: 4000,
      env: context.runtime.env,
      signal: context.runtime.signal,
    });
    expect(result.result).toEqual({
      framework: "bun",
      entrypoint: "server.ts",
      port: 4000,
      command: "bun --watch server.ts",
    });
  });
});
