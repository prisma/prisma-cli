import { writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempCwd } from "./helpers";

afterEach(() => {
  vi.doUnmock("@prisma/compute-sdk");
  vi.resetModules();
  vi.restoreAllMocks();
});

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

    const bunBuild = vi.fn().mockImplementation((options: object) => ({
      options,
      canBuild: vi.fn().mockResolvedValue(true),
      execute: vi.fn(),
    }));
    const nextjsBuild = vi.fn().mockImplementation(() => ({
      canBuild: vi.fn().mockResolvedValue(false),
      execute: vi.fn(),
    }));

    vi.doMock("@prisma/compute-sdk", () => ({
      BunBuild: bunBuild,
      NextjsBuild: nextjsBuild,
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
