import { writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempCwd } from "./helpers";

afterEach(() => {
  vi.doUnmock("@prisma/compute-sdk");
  vi.resetModules();
  vi.restoreAllMocks();
});

function mockBuildStrategy(createInstance: (options: object) => object = () => ({
  canBuild: vi.fn(),
  execute: vi.fn(),
})) {
  return vi.fn().mockImplementation(function (options: object) {
    return createInstance(options);
  });
}

describe("bun compatibility", () => {
  it("resolves the Bun entrypoint from package.json module", async () => {
    const cwd = await createTempCwd();

    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        module: "index.ts",
        devDependencies: {
          "@types/bun": "latest",
        },
      }, null, 2),
      "utf8",
    );
    await writeFile(path.join(cwd, "index.ts"), "console.log('hello');\n", "utf8");

    const { resolveBunEntrypoint } = await import("../src/lib/app/bun-project");

    await expect(resolveBunEntrypoint(cwd, undefined)).resolves.toBe("index.ts");
  });

  it("rejects Bun package reads when the command signal is already aborted", async () => {
    const cwd = await createTempCwd();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);

    const { readBunPackageJson } = await import("../src/lib/app/bun-project");

    await expect(readBunPackageJson(cwd, controller.signal)).rejects.toBe(reason);
  });

  it("detects a Bun project when package.json uses module instead of main", async () => {
    const cwd = await createTempCwd();

    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        module: "index.ts",
        devDependencies: {
          "@types/bun": "latest",
        },
        scripts: {
          dev: "bun --watch index.ts",
        },
      }, null, 2),
      "utf8",
    );
    await writeFile(path.join(cwd, "index.ts"), "console.log('hello');\n", "utf8");

    const { detectLocalBuildType } = await import("../src/lib/app/local-dev");

    await expect(detectLocalBuildType(cwd)).resolves.toBe("bun");
  });

  it("passes the module-based Bun entrypoint into the shared deploy/build strategy", async () => {
    const cwd = await createTempCwd();

    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        module: "index.ts",
        devDependencies: {
          "@types/bun": "latest",
        },
      }, null, 2),
      "utf8",
    );
    await writeFile(path.join(cwd, "index.ts"), "console.log('hello');\n", "utf8");

    const bunBuild = mockBuildStrategy((options: object) => ({
      options,
      canBuild: vi.fn().mockResolvedValue(true),
      execute: vi.fn(),
    }));
    const nextjsBuild = mockBuildStrategy(() => ({
      canBuild: vi.fn().mockResolvedValue(false),
      execute: vi.fn(),
    }));
    const otherFrameworkBuild = mockBuildStrategy(() => ({
      canBuild: vi.fn().mockResolvedValue(false),
      execute: vi.fn(),
    }));

    vi.doMock("@prisma/compute-sdk", () => ({
      AstroBuild: otherFrameworkBuild,
      BunBuild: bunBuild,
      NextjsBuild: nextjsBuild,
      NuxtBuild: otherFrameworkBuild,
      TanstackStartBuild: otherFrameworkBuild,
    }));

    const { resolvePreviewBuildStrategy } = await import("../src/lib/app/preview-build");

    const result = await resolvePreviewBuildStrategy({
      appPath: cwd,
      buildType: "auto",
      entrypoint: undefined,
    });

    expect(result.buildType).toBe("bun");
    expect(bunBuild).toHaveBeenCalledWith({
      appPath: cwd,
      entrypoint: "index.ts",
    });
  });

  it("auto-detects SDK framework strategies before falling back to Bun", async () => {
    const cwd = await createTempCwd();

    const bunBuild = mockBuildStrategy(() => ({
      canBuild: vi.fn().mockResolvedValue(true),
      execute: vi.fn(),
    }));
    const nextjsBuild = mockBuildStrategy(() => ({
      canBuild: vi.fn().mockResolvedValue(false),
      execute: vi.fn(),
    }));
    const nuxtBuild = mockBuildStrategy(() => ({
      canBuild: vi.fn().mockResolvedValue(true),
      execute: vi.fn(),
    }));
    const astroBuild = mockBuildStrategy(() => ({
      canBuild: vi.fn().mockResolvedValue(true),
      execute: vi.fn(),
    }));
    const tanstackStartBuild = mockBuildStrategy(() => ({
      canBuild: vi.fn().mockResolvedValue(true),
      execute: vi.fn(),
    }));

    vi.doMock("@prisma/compute-sdk", () => ({
      AstroBuild: astroBuild,
      BunBuild: bunBuild,
      NextjsBuild: nextjsBuild,
      NuxtBuild: nuxtBuild,
      TanstackStartBuild: tanstackStartBuild,
    }));

    const { resolvePreviewBuildStrategy } = await import("../src/lib/app/preview-build");

    const result = await resolvePreviewBuildStrategy({
      appPath: cwd,
      buildType: "auto",
      entrypoint: undefined,
    });

    expect(result.buildType).toBe("nuxt");
    expect(nuxtBuild).toHaveBeenCalledWith({ appPath: cwd });
    expect(bunBuild).not.toHaveBeenCalled();
    expect(astroBuild).not.toHaveBeenCalled();
    expect(tanstackStartBuild).not.toHaveBeenCalled();
  });

  it("resolves explicit SDK framework build strategies", async () => {
    const cwd = await createTempCwd();

    const buildStrategy = mockBuildStrategy(() => ({
      canBuild: vi.fn(),
      execute: vi.fn(),
    }));

    vi.doMock("@prisma/compute-sdk", () => ({
      AstroBuild: buildStrategy,
      BunBuild: buildStrategy,
      NextjsBuild: buildStrategy,
      NuxtBuild: buildStrategy,
      TanstackStartBuild: buildStrategy,
    }));

    const { resolvePreviewBuildStrategy } = await import("../src/lib/app/preview-build");

    await expect(resolvePreviewBuildStrategy({
      appPath: cwd,
      buildType: "astro",
      entrypoint: undefined,
    })).resolves.toMatchObject({ buildType: "astro" });

    await expect(resolvePreviewBuildStrategy({
      appPath: cwd,
      buildType: "tanstack-start",
      entrypoint: undefined,
    })).resolves.toMatchObject({ buildType: "tanstack-start" });
  });

  it("still lets an explicit Bun entrypoint override package.json module", async () => {
    const cwd = await createTempCwd();

    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        module: "index.ts",
        devDependencies: {
          "@types/bun": "latest",
        },
      }, null, 2),
      "utf8",
    );
    await writeFile(path.join(cwd, "index.ts"), "console.log('hello');\n", "utf8");
    await writeFile(path.join(cwd, "server.ts"), "console.log('server');\n", "utf8");

    const { resolveBunEntrypoint } = await import("../src/lib/app/bun-project");

    await expect(resolveBunEntrypoint(cwd, "server.ts")).resolves.toBe("server.ts");
  });
});
