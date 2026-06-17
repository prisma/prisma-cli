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
  it("does not fall back to package.json module for the Bun entrypoint", async () => {
    const cwd = await createTempCwd();

    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify(
        {
          module: "index.ts",
          devDependencies: {
            "@types/bun": "latest",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(cwd, "index.ts"),
      "console.log('hello');\n",
      "utf8",
    );

    const { resolveBunEntrypoint } = await import("../src/lib/app/bun-project");

    await expect(resolveBunEntrypoint(cwd, undefined)).rejects.toThrow(
      "Entrypoint is required. Pass --entry or define package.json main.",
    );
  });

  it("rejects Bun package reads when the command signal is already aborted", async () => {
    const cwd = await createTempCwd();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);

    const { readBunPackageJson } = await import("../src/lib/app/bun-project");

    await expect(readBunPackageJson(cwd, controller.signal)).rejects.toBe(
      reason,
    );
  });

  it("detects a Bun project from package.json main and a bun dev script", async () => {
    const cwd = await createTempCwd();

    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify(
        {
          main: "index.ts",
          devDependencies: {
            "@types/bun": "latest",
          },
          scripts: {
            dev: "bun --watch index.ts",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(cwd, "index.ts"),
      "console.log('hello');\n",
      "utf8",
    );

    const { detectLocalBuildType } = await import("../src/lib/app/local-dev");

    await expect(detectLocalBuildType(cwd)).resolves.toBe("bun");
  });

  it("forwards explicit build types to the SDK strategy resolver", async () => {
    const cwd = await createTempCwd();

    const { resolvePreviewBuildStrategy } = await import(
      "../src/lib/app/preview-build"
    );

    await expect(
      resolvePreviewBuildStrategy({
        appPath: cwd,
        buildType: "astro",
        entrypoint: undefined,
      }),
    ).resolves.toMatchObject({ buildType: "astro" });

    await expect(
      resolvePreviewBuildStrategy({
        appPath: cwd,
        buildType: "tanstack-start",
        entrypoint: undefined,
      }),
    ).resolves.toMatchObject({ buildType: "tanstack-start" });
  });

  it("lets an explicit Bun entrypoint override package.json main", async () => {
    const cwd = await createTempCwd();

    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify(
        {
          main: "index.ts",
          devDependencies: {
            "@types/bun": "latest",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(cwd, "index.ts"),
      "console.log('hello');\n",
      "utf8",
    );
    await writeFile(
      path.join(cwd, "server.ts"),
      "console.log('server');\n",
      "utf8",
    );

    const { resolveBunEntrypoint } = await import("../src/lib/app/bun-project");

    await expect(resolveBunEntrypoint(cwd, "server.ts")).resolves.toBe(
      "server.ts",
    );
  });
});
