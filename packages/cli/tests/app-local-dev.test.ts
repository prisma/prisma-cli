import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/lib/app/local-dev");
  vi.doUnmock("../src/lib/app/build");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("app local dev commands", () => {
  it("build delegates to the shared preview build helper", async () => {
    const executeAppBuild = vi.fn().mockResolvedValue({
      artifact: {
        directory: "/tmp/compute-build/app",
        entrypoint: "server.js",
      },
      buildType: "bun",
    });

    vi.doMock("../src/lib/app/build", async () => {
      const actual = await vi.importActual<
        typeof import("../src/lib/app/build")
      >("../src/lib/app/build");
      return {
        ...actual,
        executeAppBuild,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppBuild } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    const result = await runAppBuild(context, {
      entrypoint: "server.ts",
      buildType: "bun",
    });

    expect(executeAppBuild).toHaveBeenCalledWith({
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

  it("build resolves the app target from prisma.compute.ts", async () => {
    const executeAppBuild = vi.fn().mockResolvedValue({
      artifact: {
        directory: "/tmp/compute-build/app",
        entrypoint: "index.js",
      },
      buildType: "bun",
    });

    vi.doMock("../src/lib/app/build", async () => {
      const actual = await vi.importActual<
        typeof import("../src/lib/app/build")
      >("../src/lib/app/build");
      return {
        ...actual,
        executeAppBuild,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppBuild } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await mkdir(path.join(cwd, "apps", "api"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      [
        "export default {",
        "  apps: {",
        '    api: { root: "apps/api", framework: "hono", entry: "src/index.ts" },',
        '    web: { root: "apps/web", framework: "nextjs" },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    await runAppBuild(context, { configTarget: "api" });

    expect(executeAppBuild).toHaveBeenCalledWith({
      appPath: path.join(cwd, "apps", "api"),
      entrypoint: "src/index.ts",
      buildType: "bun",
      signal: context.runtime.signal,
    });
  });

  it("build run from inside a target root discovers the config and infers the target", async () => {
    const executeAppBuild = vi.fn().mockResolvedValue({
      artifact: {
        directory: "/tmp/compute-build/app",
        entrypoint: "index.js",
      },
      buildType: "bun",
    });

    vi.doMock("../src/lib/app/build", async () => {
      const actual = await vi.importActual<
        typeof import("../src/lib/app/build")
      >("../src/lib/app/build");
      return {
        ...actual,
        executeAppBuild,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppBuild } = await import("../src/controllers/app");
    const repoDir = await createTempCwd();
    const appCwd = path.join(repoDir, "apps", "api", "src");
    await mkdir(path.join(repoDir, ".git"), { recursive: true });
    await mkdir(appCwd, { recursive: true });
    await writeFile(
      path.join(repoDir, "prisma.compute.ts"),
      [
        "export default {",
        "  apps: {",
        '    api: { root: "apps/api", framework: "hono", entry: "src/index.ts" },',
        '    web: { root: "apps/web", framework: "nextjs" },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const { context } = await createTestCommandContext({
      cwd: appCwd,
      stateDir: path.join(repoDir, ".state"),
    });

    await runAppBuild(context, {});

    expect(executeAppBuild).toHaveBeenCalledWith({
      appPath: path.join(repoDir, "apps", "api"),
      entrypoint: "src/index.ts",
      buildType: "bun",
      signal: context.runtime.signal,
    });
  });

  it("build applies a committed build block by detecting the framework instead of ignoring it", async () => {
    const executeAppBuild = vi.fn().mockResolvedValue({
      artifact: {
        directory: "/tmp/compute-build/app",
        entrypoint: "server.js",
      },
      buildType: "nextjs",
    });

    vi.doMock("../src/lib/app/build", async () => {
      const actual = await vi.importActual<
        typeof import("../src/lib/app/build")
      >("../src/lib/app/build");
      return {
        ...actual,
        executeAppBuild,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppBuild } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "apps", "web"), { recursive: true });
    await writeFile(
      path.join(cwd, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { next: "15.0.0" },
      }),
      "utf8",
    );
    // No framework declared: the build block still applies via detection.
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      [
        "export default {",
        "  apps: {",
        '    web: { root: "apps/web", build: { command: "echo custom-build", outputDirectory: "out" } },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
    });

    await runAppBuild(context, { configTarget: "web" });

    expect(executeAppBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        appPath: path.join(cwd, "apps", "web"),
        buildType: "nextjs",
        buildSettings: expect.objectContaining({
          buildCommand: "echo custom-build",
          outputDirectory: "out",
        }),
      }),
    );
  });

  it("build fails clearly when a build block exists but no framework is detectable", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppBuild } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "apps", "mystery"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      [
        "export default {",
        "  apps: {",
        '    mystery: { root: "apps/mystery", build: { command: "make build", outputDirectory: "out" } },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
    });

    await expect(
      runAppBuild(context, { configTarget: "mystery" }),
    ).rejects.toMatchObject({
      code: "FRAMEWORK_NOT_DETECTED",
    });
  });

  it("build accepts explicit SDK framework strategies", async () => {
    const executeAppBuild = vi.fn().mockResolvedValue({
      artifact: {
        directory: "/tmp/compute-build/app",
        entrypoint: "server/entry.mjs",
      },
      buildType: "astro",
    });

    vi.doMock("../src/lib/app/build", async () => {
      const actual = await vi.importActual<
        typeof import("../src/lib/app/build")
      >("../src/lib/app/build");
      return {
        ...actual,
        executeAppBuild,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppBuild } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    const result = await runAppBuild(context, { buildType: "astro" });

    expect(executeAppBuild).toHaveBeenCalledWith({
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
    const executeAppBuild = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Entrypoint is required. Pass --entry or define package.json main or module.",
        ),
      );

    vi.doMock("../src/lib/app/build", async () => {
      const actual = await vi.importActual<
        typeof import("../src/lib/app/build")
      >("../src/lib/app/build");
      return {
        ...actual,
        executeAppBuild,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppBuild } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    await expect(
      runAppBuild(context, { buildType: "auto" }),
    ).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary:
        "App build requires an explicit framework when detection is ambiguous",
    });
  });

  it("run returns USAGE_ERROR for --json", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await expect(
      runAppRun(context, { buildType: "auto" }),
    ).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "App run does not support --json",
    });
  });

  it("run returns USAGE_ERROR when framework detection is ambiguous", async () => {
    const resolveLocalBuildType = vi.fn().mockResolvedValue(null);

    vi.doMock("../src/lib/app/local-dev", async () => {
      const actual = await vi.importActual<
        typeof import("../src/lib/app/local-dev")
      >("../src/lib/app/local-dev");
      return {
        ...actual,
        resolveLocalBuildType,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRun } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    await expect(
      runAppRun(context, { buildType: "auto" }),
    ).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary:
        "App run requires an explicit framework when detection is ambiguous",
    });
  });

  it("run rejects --entry together with --build-type nextjs", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRun } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    await expect(
      runAppRun(context, { entrypoint: "server.ts", buildType: "nextjs" }),
    ).rejects.toMatchObject({
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
      const actual = await vi.importActual<
        typeof import("../src/lib/app/local-dev")
      >("../src/lib/app/local-dev");
      return {
        ...actual,
        runLocalApp,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRun } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
    });

    const result = await runAppRun(context, {
      entrypoint: "server.ts",
      buildType: "bun",
      port: "4000",
    });

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
