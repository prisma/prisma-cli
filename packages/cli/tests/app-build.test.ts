import {
  access,
  lstat,
  mkdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempCwd } from "./helpers";

afterEach(() => {
  vi.doUnmock("node:child_process");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("preview build strategy", () => {
  it("resolves inferred Next.js settings without writing any file", async () => {
    const { resolveInferredAppBuildSettings } = await import(
      "../src/lib/app/build"
    );
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");

    await mkdir(appPath, { recursive: true });
    await writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify(
        {
          packageManager: "bun@1.2.0",
          scripts: {
            build: "prisma generate && next build",
          },
          dependencies: {
            next: "15.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const resolution = await resolveInferredAppBuildSettings({
      appPath,
      buildType: "nextjs",
    });

    expect(resolution.status).toBe("inferred");
    expect(resolution.configPath).toBeNull();
    expect(resolution.settings).toEqual({
      buildCommand: "bun run build",
      buildCommandSource: "package.json scripts.build",
      outputDirectory: ".next/standalone",
      outputDirectorySource: "Next.js output",
    });
    await expect(
      readFile(path.join(appPath, "prisma.app.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("describes the strategy-owned builds for nuxt and astro", async () => {
    const { resolveInferredAppBuildSettings } = await import(
      "../src/lib/app/build"
    );
    const cwd = await createTempCwd();

    const nuxt = await resolveInferredAppBuildSettings({
      appPath: cwd,
      buildType: "nuxt",
    });
    expect(nuxt.settings).toEqual({
      buildCommand: "nuxt build",
      buildCommandSource: "Nuxt default",
      outputDirectory: ".output",
      outputDirectorySource: "Nuxt output",
    });

    const astro = await resolveInferredAppBuildSettings({
      appPath: cwd,
      buildType: "astro",
    });
    expect(astro.settings).toEqual({
      buildCommand: "astro build",
      buildCommandSource: "Astro default",
      outputDirectory: "dist",
      outputDirectorySource: "Astro output",
    });
  });

  it("packages the full tree with a next start launcher when the build produces no standalone output", async () => {
    const { AppBuildStrategy } = await import("../src/lib/app/build");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");

    await mkdir(path.join(appPath, ".next"), { recursive: true });
    await mkdir(path.join(appPath, "node_modules/next"), { recursive: true });
    await writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify({ dependencies: { next: "15.0.0" } }),
      "utf8",
    );
    await writeFile(
      path.join(appPath, ".next/BUILD_ID"),
      "fallback-test",
      "utf8",
    );
    await writeFile(
      path.join(appPath, ".env"),
      "SECRET=should-not-ship",
      "utf8",
    );
    await writeFile(
      path.join(appPath, ".env.local"),
      "SECRET=should-not-ship",
      "utf8",
    );
    await writeFile(
      path.join(appPath, "node_modules/next/package.json"),
      JSON.stringify({ name: "next", version: "15.0.0" }),
      "utf8",
    );
    await mkdir(path.join(appPath, "node_modules/.bin"), { recursive: true });
    await symlink(
      "../next/package.json",
      path.join(appPath, "node_modules/.bin/next-link"),
    );

    const strategy = new AppBuildStrategy({
      appPath,
      buildType: "nextjs",
      buildSettings: {
        buildCommand: null,
        buildCommandSource: null,
        outputDirectory: ".next/standalone",
        outputDirectorySource: null,
      },
    });

    const artifact = await strategy.execute();
    try {
      expect(artifact.entrypoint).toBe("prisma-next-start.cjs");
      expect(artifact.defaultPortMapping).toEqual({ http: 3000 });

      const launcher = await readFile(
        path.join(artifact.directory, "prisma-next-start.cjs"),
        "utf8",
      );
      expect(launcher).toContain('require("next/dist/bin/next")');
      expect(launcher).toContain('process.argv.push("start"');
      expect(launcher).toContain("process.chdir(__dirname)");

      await expect(
        readFile(path.join(artifact.directory, ".next/BUILD_ID"), "utf8"),
      ).resolves.toBe("fallback-test");
      await expect(
        readFile(
          path.join(artifact.directory, "node_modules/next/package.json"),
          "utf8",
        ),
      ).resolves.toContain("15.0.0");

      const linkPath = path.join(
        artifact.directory,
        "node_modules/.bin/next-link",
      );
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
      expect((await readlink(linkPath)).split(path.sep).join("/")).toBe(
        "../next/package.json",
      );

      await expect(
        access(path.join(artifact.directory, ".env")),
      ).rejects.toThrow();
      await expect(
        access(path.join(artifact.directory, ".env.local")),
      ).rejects.toThrow();
    } finally {
      const stagedDir = artifact.directory;
      await artifact.cleanup?.();
      await expect(access(stagedDir)).rejects.toThrow();
    }
  });

  it("infers TanStack and Hono build defaults", async () => {
    const { resolveInferredAppBuildSettings } = await import(
      "../src/lib/app/build"
    );
    const cwd = await createTempCwd();
    const tanstackPath = path.join(cwd, "tanstack");
    const honoPath = path.join(cwd, "hono");

    await mkdir(tanstackPath, { recursive: true });
    await writeFile(
      path.join(tanstackPath, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            "@tanstack/react-start": "1.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await mkdir(honoPath, { recursive: true });
    await writeFile(
      path.join(honoPath, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            hono: "4.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      resolveInferredAppBuildSettings({
        appPath: tanstackPath,
        buildType: "tanstack-start",
      }),
    ).resolves.toMatchObject({
      status: "inferred",
      settings: {
        buildCommand: "vite build",
        outputDirectory: ".output",
      },
    });
    await expect(
      resolveInferredAppBuildSettings({
        appPath: honoPath,
        buildType: "bun",
      }),
    ).resolves.toMatchObject({
      status: "inferred",
      settings: {
        buildCommand: null,
        outputDirectory: ".",
      },
    });
  });

  it("classifies leftover prisma.app.json files for migration", async () => {
    const { detectLegacyBuildSettings } = await import("../src/lib/app/build");
    const cwd = await createTempCwd();
    const effective = {
      buildCommand: "bun run build",
      buildCommandSource: null,
      outputDirectory: ".next/standalone",
      outputDirectorySource: null,
    };

    await expect(
      detectLegacyBuildSettings({ appPath: cwd, effective }),
    ).resolves.toEqual({ kind: "absent" });

    await writeFile(
      path.join(cwd, "prisma.app.json"),
      JSON.stringify({
        buildCommand: "bun run build",
        outputDirectory: ".next/standalone",
      }),
      "utf8",
    );
    await expect(
      detectLegacyBuildSettings({ appPath: cwd, effective }),
    ).resolves.toMatchObject({ kind: "matching" });

    await writeFile(
      path.join(cwd, "prisma.app.json"),
      JSON.stringify({
        buildCommand: "custom-build",
        outputDirectory: "dist",
      }),
      "utf8",
    );
    await expect(
      detectLegacyBuildSettings({ appPath: cwd, effective }),
    ).resolves.toMatchObject({
      kind: "custom",
      buildCommand: "custom-build",
      outputDirectory: "dist",
    });

    await writeFile(path.join(cwd, "prisma.app.json"), "{ nope\n", "utf8");
    await expect(
      detectLegacyBuildSettings({ appPath: cwd, effective }),
    ).resolves.toMatchObject({ kind: "invalid" });
  });

  it("resolves package.json build scripts and literal framework output directories", async () => {
    const { resolveAppBuildSettings } = await import("../src/lib/app/build");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");

    await mkdir(appPath, { recursive: true });
    await writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify(
        {
          packageManager: "pnpm@10.0.0",
          scripts: {
            build: "prisma generate && next build",
          },
          dependencies: {
            next: "15.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(appPath, "next.config.js"),
      "module.exports = { output: 'standalone', distDir: 'build' };\n",
      "utf8",
    );

    await expect(
      resolveAppBuildSettings({
        appPath,
        buildType: "nextjs",
      }),
    ).resolves.toEqual({
      buildCommand: "pnpm run build",
      buildCommandSource: "package.json scripts.build",
      outputDirectory: "build/standalone",
      outputDirectorySource: "next.config distDir",
    });
  });

  it("only reads Next.js distDir from the exported config object", async () => {
    const { resolveAppBuildSettings } = await import("../src/lib/app/build");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");

    await mkdir(appPath, { recursive: true });
    await writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify(
        {
          packageManager: "pnpm@10.0.0",
          scripts: {
            build: "next build",
          },
          dependencies: {
            next: "15.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(appPath, "next.config.ts"),
      [
        "const unrelated = { distDir: 'wrong' };",
        "const nextConfig = { output: 'standalone', distDir: 'build' } satisfies object;",
        "export default defineConfig(nextConfig);",
      ].join("\n"),
      "utf8",
    );

    await expect(
      resolveAppBuildSettings({
        appPath,
        buildType: "nextjs",
      }),
    ).resolves.toMatchObject({
      outputDirectory: "build/standalone",
      outputDirectorySource: "next.config distDir",
    });
  });

  it("ignores commented or unrelated Next.js distDir values", async () => {
    const { resolveAppBuildSettings } = await import("../src/lib/app/build");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");

    await mkdir(appPath, { recursive: true });
    await writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify(
        {
          packageManager: "pnpm@10.0.0",
          scripts: {
            build: "next build",
          },
          dependencies: {
            next: "15.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(appPath, "next.config.js"),
      [
        "// distDir: 'commented'",
        "const unrelated = { distDir: 'wrong' };",
        "module.exports = { output: 'standalone' };",
      ].join("\n"),
      "utf8",
    );

    await expect(
      resolveAppBuildSettings({
        appPath,
        buildType: "nextjs",
      }),
    ).resolves.toMatchObject({
      outputDirectory: ".next/standalone",
      outputDirectorySource: "Next.js output",
    });
  });

  it("detects the package manager for package.json build scripts", async () => {
    const { resolveAppBuildSettings } = await import("../src/lib/app/build");
    const cases = [
      { lockfile: "bun.lock", command: "bun run build" },
      { lockfile: "pnpm-lock.yaml", command: "pnpm run build" },
      { lockfile: "yarn.lock", command: "yarn run build" },
      { lockfile: "package-lock.json", command: "npm run build" },
    ];

    for (const testCase of cases) {
      const cwd = await createTempCwd();
      const appPath = path.join(cwd, "app");

      await mkdir(appPath, { recursive: true });
      await writeFile(
        path.join(appPath, "package.json"),
        JSON.stringify(
          {
            scripts: {
              build: "next build",
            },
            dependencies: {
              next: "15.0.0",
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await writeFile(path.join(appPath, testCase.lockfile), "", "utf8");

      await expect(
        resolveAppBuildSettings({
          appPath,
          buildType: "nextjs",
        }),
      ).resolves.toMatchObject({
        buildCommand: testCase.command,
        buildCommandSource: "package.json scripts.build",
      });
    }
  });

  it("detects the package manager from the workspace root for app build scripts", async () => {
    const { resolveAppBuildSettings } = await import("../src/lib/app/build");
    const cases = [
      {
        rootFiles: ["pnpm-workspace.yaml", "pnpm-lock.yaml"],
        command: "pnpm run build",
      },
      {
        rootFiles: ["package-lock.json"],
        rootPackageJson: { workspaces: ["apps/*"] },
        command: "npm run build",
      },
      {
        rootFiles: ["yarn.lock"],
        rootPackageJson: { workspaces: ["apps/*"] },
        command: "yarn run build",
      },
    ];

    for (const testCase of cases) {
      const cwd = await createTempCwd();
      const appPath = path.join(cwd, "apps", "web");

      await mkdir(appPath, { recursive: true });
      if (testCase.rootPackageJson) {
        await writeFile(
          path.join(cwd, "package.json"),
          JSON.stringify(testCase.rootPackageJson, null, 2),
          "utf8",
        );
      }
      for (const rootFile of testCase.rootFiles) {
        await writeFile(path.join(cwd, rootFile), "", "utf8");
      }
      await writeFile(
        path.join(appPath, "package.json"),
        JSON.stringify(
          {
            scripts: {
              build: "next build",
            },
            dependencies: {
              next: "15.0.0",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      await expect(
        resolveAppBuildSettings({
          appPath,
          buildType: "nextjs",
        }),
      ).resolves.toMatchObject({
        buildCommand: testCase.command,
        buildCommandSource: "package.json scripts.build",
      });
    }
  });

  it("prefers the app-level lockfile over the workspace root lockfile", async () => {
    const { resolveAppBuildSettings } = await import("../src/lib/app/build");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "apps", "web");

    await mkdir(appPath, { recursive: true });
    await writeFile(path.join(cwd, "pnpm-workspace.yaml"), "", "utf8");
    await writeFile(path.join(cwd, "pnpm-lock.yaml"), "", "utf8");
    await writeFile(path.join(appPath, "bun.lock"), "", "utf8");
    await writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify(
        {
          scripts: {
            build: "next build",
          },
          dependencies: {
            next: "15.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      resolveAppBuildSettings({
        appPath,
        buildType: "nextjs",
      }),
    ).resolves.toMatchObject({
      buildCommand: "bun run build",
    });
  });

  it("does not use lockfiles above the repository root", async () => {
    const { resolveAppBuildSettings } = await import("../src/lib/app/build");
    const cwd = await createTempCwd();
    const repoPath = path.join(cwd, "repo");
    const appPath = path.join(repoPath, "app");

    await mkdir(path.join(repoPath, ".git"), { recursive: true });
    await mkdir(appPath, { recursive: true });
    await writeFile(path.join(cwd, "pnpm-lock.yaml"), "", "utf8");
    await writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify(
        {
          scripts: {
            build: "custom-build",
          },
          dependencies: {
            next: "15.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      resolveAppBuildSettings({
        appPath,
        buildType: "nextjs",
      }),
    ).resolves.toMatchObject({
      buildCommand: "custom-build",
    });
  });

  it("uses the literal package.json build script when no package manager is detected", async () => {
    const { resolveAppBuildSettings } = await import("../src/lib/app/build");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");

    await mkdir(appPath, { recursive: true });
    await writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify(
        {
          scripts: {
            build: "custom-build",
          },
          dependencies: {
            next: "15.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      resolveAppBuildSettings({
        appPath,
        buildType: "nextjs",
      }),
    ).resolves.toMatchObject({
      buildCommand: "custom-build",
      buildCommandSource: "package.json scripts.build",
    });
  });

  it("does not detect unsupported next.config.cjs files as Next.js", async () => {
    const { resolveAppBuildStrategy } = await import("../src/lib/app/build");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");

    await mkdir(appPath, { recursive: true });
    await writeFile(
      path.join(appPath, "package.json"),
      `${JSON.stringify({}, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(appPath, "server.ts"),
      "export default { fetch: () => new Response('ok') };\n",
      "utf8",
    );
    await writeFile(
      path.join(appPath, "next.config.cjs"),
      "module.exports = { output: 'standalone' };\n",
      "utf8",
    );

    await expect(
      resolveAppBuildStrategy({
        appPath,
        entrypoint: "server.ts",
        buildType: "auto",
      }),
    ).resolves.toMatchObject({
      buildType: "bun",
    });
  });

  it("resolves an explicit entrypoint to Bun even when Next.js is detectable", async () => {
    const { resolveAppBuildStrategy } = await import("../src/lib/app/build");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");

    await mkdir(appPath, { recursive: true });
    await writeFile(
      path.join(appPath, "package.json"),
      `${JSON.stringify({ dependencies: { next: "15.0.0" } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(appPath, "server.ts"),
      "export default { fetch: () => new Response('ok') };\n",
      "utf8",
    );

    await expect(
      resolveAppBuildStrategy({
        appPath,
        entrypoint: "server.ts",
        buildType: "auto",
      }),
    ).resolves.toMatchObject({
      buildType: "bun",
    });
  });

  it("runs package.json build scripts before staging Next.js output", async () => {
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");

    await mkdir(appPath, { recursive: true });
    await writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify(
        {
          packageManager: "npm@10.0.0",
          scripts: {
            build: "node build.mjs",
          },
          dependencies: {
            next: "15.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(appPath, "build.mjs"),
      [
        "import { mkdir, writeFile } from 'node:fs/promises';",
        "await mkdir('.next/standalone', { recursive: true });",
        "await mkdir('.next/static', { recursive: true });",
        "await mkdir('public', { recursive: true });",
        "await writeFile('.next/standalone/server.js', \"console.log('next');\\n\");",
        "await writeFile('.next/static/client.js', \"console.log('static');\\n\");",
        "await writeFile('public/hello.txt', 'hello\\n');",
      ].join("\n"),
      "utf8",
    );

    const { executeAppBuild } = await import("../src/lib/app/build");
    const result = await executeAppBuild({
      appPath,
      buildType: "nextjs",
    });

    expect(result.buildType).toBe("nextjs");
    expect(result.artifact.entrypoint).toBe("server.js");
    await expect(
      readFile(
        path.join(result.artifact.directory, ".next", "static", "client.js"),
        "utf8",
      ),
    ).resolves.toContain("static");
    await expect(
      readFile(
        path.join(result.artifact.directory, "public", "hello.txt"),
        "utf8",
      ),
    ).resolves.toContain("hello");
    await result.artifact.cleanup?.();
  });

  it("skips the build command when prisma.app.json sets buildCommand to null", async () => {
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");
    const outputDir = path.join(appPath, ".next", "standalone");

    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, "server.js"),
      "console.log('prebuilt');\n",
      "utf8",
    );

    const { executeAppBuild } = await import("../src/lib/app/build");
    const result = await executeAppBuild({
      appPath,
      buildType: "nextjs",
      buildSettings: {
        buildCommand: null,
        buildCommandSource: null,
        outputDirectory: ".next/standalone",
        outputDirectorySource: null,
      },
    });

    expect(result.buildType).toBe("nextjs");
    expect(result.artifact.entrypoint).toBe("server.js");
    await expect(
      readFile(path.join(result.artifact.directory, "server.js"), "utf8"),
    ).resolves.toContain("prebuilt");
    await result.artifact.cleanup?.();
  });

  it("returns the Next.js default HTTP port mapping in the built artifact", async () => {
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");
    const standaloneDir = path.join(appPath, ".next", "standalone");

    await mkdir(path.join(standaloneDir, ".next", "static"), {
      recursive: true,
    });
    await mkdir(path.join(appPath, ".next", "static"), { recursive: true });
    await writeFile(
      path.join(appPath, ".next", "static", "client.js"),
      "console.log('static');\n",
      "utf8",
    );
    await mkdir(path.join(appPath, "public"), { recursive: true });
    await writeFile(
      path.join(appPath, "public", "hello.txt"),
      "hello\n",
      "utf8",
    );
    await writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify({
        scripts: { build: "node -e 0" },
        dependencies: { next: "15.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      path.join(appPath, "next.config.ts"),
      "export default { output: 'standalone' };\n",
      "utf8",
    );
    await writeFile(
      path.join(standaloneDir, "server.js"),
      "console.log('next');\n",
      "utf8",
    );

    const { executeAppBuild } = await import("../src/lib/app/build");
    const result = await executeAppBuild({
      appPath,
      buildType: "nextjs",
    });

    expect(result.buildType).toBe("nextjs");
    expect(result.artifact.entrypoint).toBe("server.js");
    expect(result.artifact.defaultPortMapping).toEqual({ http: 3000 });
    await expect(
      readFile(
        path.join(result.artifact.directory, ".next", "static", "client.js"),
        "utf8",
      ),
    ).resolves.toContain("static");
    await expect(
      readFile(
        path.join(result.artifact.directory, "public", "hello.txt"),
        "utf8",
      ),
    ).resolves.toContain("hello");
    await result.artifact.cleanup?.();
  });

  it("materializes symlinks that point back to the source app directory", async () => {
    const { normalizeArtifactSymlinks } = await import("@prisma/compute-sdk");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");
    const artifactDir = path.join(cwd, "artifact");
    const sourceTarget = path.join(
      appPath,
      ".next/standalone/node_modules/.pnpm/pkg-b/node_modules/pkg-b",
    );
    const copiedLink = path.join(
      artifactDir,
      "node_modules/.pnpm/pkg-a/node_modules/pkg-b",
    );

    await mkdir(sourceTarget, { recursive: true });
    await writeFile(
      path.join(sourceTarget, "index.js"),
      "export const value = 1;\n",
      "utf8",
    );

    await mkdir(path.dirname(copiedLink), { recursive: true });
    await symlink(sourceTarget, copiedLink, "dir");

    await normalizeArtifactSymlinks(artifactDir, appPath);

    expect((await lstat(copiedLink)).isSymbolicLink()).toBe(false);
    await expect(
      readFile(path.join(copiedLink, "index.js"), "utf8"),
    ).resolves.toContain("value = 1");
  });

  it("stages Next.js standalone artifacts by preserving internal symlinks and materializing fallback targets", async () => {
    const { stageStandaloneArtifact: stageNextjsStandaloneArtifact } =
      await import("@prisma/compute-sdk");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");
    const standaloneDir = path.join(appPath, ".next", "standalone");
    const artifactDir = path.join(cwd, "artifact");

    const standaloneTarget = path.join(
      standaloneDir,
      "node_modules/.pnpm/sharp@0.34.5/node_modules/sharp",
    );
    const standaloneLink = path.join(
      standaloneDir,
      "node_modules/.pnpm/node_modules/sharp",
    );
    const appFallbackTarget = path.join(
      appPath,
      "node_modules/.pnpm/semver@6.3.1/node_modules/semver",
    );
    const standaloneMissingLink = path.join(
      standaloneDir,
      "node_modules/.pnpm/node_modules/semver",
    );

    await mkdir(standaloneTarget, { recursive: true });
    await writeFile(
      path.join(standaloneTarget, "index.js"),
      "export const sharp = true;\n",
      "utf8",
    );
    await mkdir(path.dirname(standaloneLink), { recursive: true });
    await symlink("../sharp@0.34.5/node_modules/sharp", standaloneLink, "dir");

    await mkdir(appFallbackTarget, { recursive: true });
    await writeFile(
      path.join(appFallbackTarget, "index.js"),
      "export const semver = true;\n",
      "utf8",
    );
    await mkdir(path.dirname(standaloneMissingLink), { recursive: true });
    await symlink(
      "../semver@6.3.1/node_modules/semver",
      standaloneMissingLink,
      "dir",
    );

    await stageNextjsStandaloneArtifact({
      standaloneDir,
      artifactDir,
      appPath,
    });

    const copiedStandaloneTarget = path.join(
      artifactDir,
      "node_modules/.pnpm/node_modules/sharp",
    );
    const copiedFallbackTarget = path.join(
      artifactDir,
      "node_modules/.pnpm/node_modules/semver",
    );

    expect((await lstat(copiedStandaloneTarget)).isSymbolicLink()).toBe(true);
    expect((await lstat(copiedFallbackTarget)).isSymbolicLink()).toBe(false);
    await expect(
      readFile(path.join(copiedStandaloneTarget, "index.js"), "utf8"),
    ).resolves.toContain("sharp = true");
    await expect(
      readFile(path.join(copiedFallbackTarget, "index.js"), "utf8"),
    ).resolves.toContain("semver = true");
  });

  it("stages Next.js standalone symlinks that resolve through the monorepo root", async () => {
    const { stageStandaloneArtifact: stageNextjsStandaloneArtifact } =
      await import("@prisma/compute-sdk");
    const cwd = await createTempCwd();
    const repoRoot = path.join(cwd, "repo");
    const appPath = path.join(repoRoot, "apps", "web");
    const standaloneDir = path.join(appPath, ".next", "standalone");
    const artifactDir = path.join(cwd, "artifact");
    const rootDependency = path.join(repoRoot, "node_modules", "pg");
    const standaloneLink = path.join(standaloneDir, "node_modules", "pg");

    await mkdir(path.join(repoRoot, ".git"), { recursive: true });
    await mkdir(rootDependency, { recursive: true });
    await writeFile(
      path.join(rootDependency, "index.js"),
      "export const pg = true;\n",
      "utf8",
    );
    await mkdir(path.dirname(standaloneLink), { recursive: true });
    await symlink(
      path.relative(path.dirname(standaloneLink), rootDependency),
      standaloneLink,
      "dir",
    );

    await stageNextjsStandaloneArtifact({
      standaloneDir,
      artifactDir,
      appPath,
    });

    const copiedDependency = path.join(artifactDir, "node_modules", "pg");

    expect((await lstat(copiedDependency)).isSymbolicLink()).toBe(false);
    await expect(
      readFile(path.join(copiedDependency, "index.js"), "utf8"),
    ).resolves.toContain("pg = true");
  });

  it("keeps pnpm transitive dependencies resolvable after flattening Next.js standalone packages", async () => {
    const { stageStandaloneArtifact: stageNextjsStandaloneArtifact } =
      await import("@prisma/compute-sdk");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");
    const standaloneDir = path.join(appPath, ".next", "standalone");
    const artifactDir = path.join(cwd, "artifact");
    const nextStorePackage = path.join(
      standaloneDir,
      "node_modules/.pnpm/next@16.2.3/node_modules/next",
    );
    const nextLink = path.join(standaloneDir, "node_modules/next");
    const swcHelperPackage = path.join(
      standaloneDir,
      "node_modules/.pnpm/@swc+helpers@0.5.15/node_modules/@swc/helpers/_",
    );
    const swcHoistedLink = path.join(
      standaloneDir,
      "node_modules/.pnpm/node_modules/@swc/helpers",
    );

    await mkdir(path.join(nextStorePackage, "dist/shared/lib"), {
      recursive: true,
    });
    await writeFile(
      path.join(nextStorePackage, "dist/shared/lib/constants.js"),
      "module.exports = require('@swc/helpers/_/_interop_require_default');\n",
      "utf8",
    );
    await mkdir(path.dirname(nextLink), { recursive: true });
    await symlink(".pnpm/next@16.2.3/node_modules/next", nextLink, "dir");

    await mkdir(swcHelperPackage, { recursive: true });
    await writeFile(
      path.join(swcHelperPackage, "_interop_require_default.js"),
      "module.exports = { default: true };\n",
      "utf8",
    );
    await mkdir(path.dirname(swcHoistedLink), { recursive: true });
    await symlink(
      "../../@swc+helpers@0.5.15/node_modules/@swc/helpers",
      swcHoistedLink,
      "dir",
    );

    await stageNextjsStandaloneArtifact({
      standaloneDir,
      artifactDir,
      appPath,
    });

    const constants = path.join(
      artifactDir,
      "node_modules/next/dist/shared/lib/constants.js",
    );
    const requireFromNext = createRequire(constants);

    expect(() =>
      requireFromNext.resolve("@swc/helpers/_/_interop_require_default"),
    ).not.toThrow();
  });

  it("places public and .next/static next to server.js when the entrypoint is nested (monorepo)", async () => {
    const { restageNextjsArtifact } = await import("../src/lib/app/build");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "repo", "apps", "web");
    const standaloneDir = path.join(appPath, ".next", "standalone");
    const nestedServerDir = path.join(standaloneDir, "apps", "web");
    const artifactDir = path.join(cwd, "artifact");

    await mkdir(path.join(cwd, "repo", ".git"), { recursive: true });
    await mkdir(nestedServerDir, { recursive: true });
    await writeFile(
      path.join(nestedServerDir, "server.js"),
      "// nested server\n",
      "utf8",
    );
    await mkdir(path.join(standaloneDir, "node_modules"), { recursive: true });

    await mkdir(path.join(appPath, "public"), { recursive: true });
    await writeFile(
      path.join(appPath, "public", "hello.txt"),
      "hello\n",
      "utf8",
    );
    await mkdir(path.join(appPath, ".next", "static"), { recursive: true });
    await writeFile(
      path.join(appPath, ".next", "static", "client.js"),
      "// static\n",
      "utf8",
    );

    // Seed an existing (incorrect) artifact directory to mirror what the SDK
    // produces before the CLI re-stages it.
    await mkdir(artifactDir, { recursive: true });

    await restageNextjsArtifact(
      { directory: artifactDir, entrypoint: "apps/web/server.js" },
      appPath,
    );

    await expect(
      readFile(
        path.join(artifactDir, "apps", "web", "public", "hello.txt"),
        "utf8",
      ),
    ).resolves.toContain("hello");
    await expect(
      readFile(
        path.join(artifactDir, "apps", "web", ".next", "static", "client.js"),
        "utf8",
      ),
    ).resolves.toContain("static");
  });

  it("drops dangling pnpm hoist symlinks when staging Next.js standalone artifacts", async () => {
    const { stageStandaloneArtifact: stageNextjsStandaloneArtifact } =
      await import("@prisma/compute-sdk");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");
    const standaloneDir = path.join(appPath, ".next", "standalone");
    const artifactDir = path.join(cwd, "artifact");

    const realTarget = path.join(
      standaloneDir,
      "node_modules/.pnpm/real@1.0.0/node_modules/real",
    );
    const realLink = path.join(
      standaloneDir,
      "node_modules/.pnpm/node_modules/real",
    );
    await mkdir(realTarget, { recursive: true });
    await writeFile(
      path.join(realTarget, "index.js"),
      "export const real = true;\n",
      "utf8",
    );
    await mkdir(path.dirname(realLink), { recursive: true });
    await symlink("../real@1.0.0/node_modules/real", realLink, "dir");

    const danglingLink = path.join(
      standaloneDir,
      "node_modules/.pnpm/node_modules/missing-pkg",
    );
    await symlink(
      "../missing-pkg@1.0.0/node_modules/missing-pkg",
      danglingLink,
      "dir",
    );

    const danglingScopedLink = path.join(
      standaloneDir,
      "node_modules/.pnpm/node_modules/@scope/missing-pkg",
    );
    await mkdir(path.dirname(danglingScopedLink), { recursive: true });
    await symlink(
      "../../@scope+missing-pkg@1.0.0/node_modules/@scope/missing-pkg",
      danglingScopedLink,
      "dir",
    );

    await stageNextjsStandaloneArtifact({
      standaloneDir,
      artifactDir,
      appPath,
    });

    await expect(
      readFile(path.join(artifactDir, "node_modules/real/index.js"), "utf8"),
    ).resolves.toContain("real = true");
    await expect(
      lstat(
        path.join(artifactDir, "node_modules/.pnpm/node_modules/missing-pkg"),
      ),
    ).rejects.toThrow();
    await expect(
      lstat(path.join(artifactDir, "node_modules/missing-pkg")),
    ).rejects.toThrow();
    await expect(
      lstat(path.join(artifactDir, "node_modules/@scope/missing-pkg")),
    ).rejects.toThrow();
  });

  it("still rejects dangling Next.js standalone symlinks outside the pnpm hoist layer", async () => {
    const { stageStandaloneArtifact: stageNextjsStandaloneArtifact } =
      await import("@prisma/compute-sdk");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");
    const standaloneDir = path.join(appPath, ".next", "standalone");
    const artifactDir = path.join(cwd, "artifact");

    const brokenTopLevelLink = path.join(
      standaloneDir,
      "node_modules",
      "missing-direct",
    );
    await mkdir(path.dirname(brokenTopLevelLink), { recursive: true });
    await symlink(
      ".pnpm/missing-direct@1.0.0/node_modules/missing-direct",
      brokenTopLevelLink,
      "dir",
    );

    await expect(
      stageNextjsStandaloneArtifact({
        standaloneDir,
        artifactDir,
        appPath,
      }),
    ).rejects.toThrow("symlink target is missing");
  });

  it("rejects Next.js standalone symlinks that escape the app directory", async () => {
    const { stageStandaloneArtifact: stageNextjsStandaloneArtifact } =
      await import("@prisma/compute-sdk");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");
    const standaloneDir = path.join(appPath, ".next", "standalone");
    const artifactDir = path.join(cwd, "artifact");
    const escapeTarget = path.join(cwd, "escape");
    const escapeLink = path.join(standaloneDir, "node_modules/escape");

    await mkdir(path.join(appPath, ".git"), { recursive: true });
    await mkdir(escapeTarget, { recursive: true });
    await writeFile(
      path.join(escapeTarget, "index.js"),
      "export const escaped = true;\n",
      "utf8",
    );
    await mkdir(path.dirname(escapeLink), { recursive: true });
    await symlink(escapeTarget, escapeLink, "dir");

    await expect(
      stageNextjsStandaloneArtifact({
        standaloneDir,
        artifactDir,
        appPath,
      }),
    ).rejects.toThrow("escapes the app directory");
  });
});
