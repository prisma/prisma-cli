import { chmod, lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
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
  it("returns the Next.js default HTTP port mapping in the built artifact", async () => {
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");
    const standaloneDir = path.join(appPath, ".next", "standalone");
    const nextBin = path.join(appPath, "node_modules", ".bin", "next");

    await mkdir(path.join(standaloneDir, ".next", "static"), { recursive: true });
    await mkdir(path.join(appPath, ".next", "static"), { recursive: true });
    await writeFile(path.join(appPath, ".next", "static", "client.js"), "console.log('static');\n", "utf8");
    await mkdir(path.join(appPath, "public"), { recursive: true });
    await writeFile(path.join(appPath, "public", "hello.txt"), "hello\n", "utf8");
    await mkdir(path.dirname(nextBin), { recursive: true });
    await writeFile(path.join(appPath, "next.config.ts"), "export default { output: 'standalone' };\n", "utf8");
    await writeFile(path.join(standaloneDir, "server.js"), "console.log('next');\n", "utf8");
    await writeFile(nextBin, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(nextBin, 0o755);

    const { executePreviewBuild } = await import("../src/lib/app/preview-build");
    const result = await executePreviewBuild({
      appPath,
      buildType: "nextjs",
    });

    expect(result.buildType).toBe("nextjs");
    expect(result.artifact.entrypoint).toBe("server.js");
    expect(result.artifact.defaultPortMapping).toEqual({ http: 3000 });
    await expect(readFile(path.join(result.artifact.directory, ".next", "static", "client.js"), "utf8")).resolves.toContain("static");
    await expect(readFile(path.join(result.artifact.directory, "public", "hello.txt"), "utf8")).resolves.toContain("hello");
    await result.artifact.cleanup?.();
  });

  it("materializes symlinks that point back to the source app directory", async () => {
    const { normalizeArtifactSymlinks } = await import("../src/lib/app/preview-build");
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
    await writeFile(path.join(sourceTarget, "index.js"), "export const value = 1;\n", "utf8");

    await mkdir(path.dirname(copiedLink), { recursive: true });
    await symlink(sourceTarget, copiedLink, "dir");

    await normalizeArtifactSymlinks(artifactDir, appPath);

    expect((await lstat(copiedLink)).isSymbolicLink()).toBe(false);
    await expect(readFile(path.join(copiedLink, "index.js"), "utf8")).resolves.toContain(
      "value = 1",
    );
  });

  it("stages Next.js standalone artifacts by materializing symlinks and falling back to app node_modules", async () => {
    const { stageNextjsStandaloneArtifact } = await import("../src/lib/app/preview-build");
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
    await writeFile(path.join(standaloneTarget, "index.js"), "export const sharp = true;\n", "utf8");
    await mkdir(path.dirname(standaloneLink), { recursive: true });
    await symlink("../sharp@0.34.5/node_modules/sharp", standaloneLink, "dir");

    await mkdir(appFallbackTarget, { recursive: true });
    await writeFile(path.join(appFallbackTarget, "index.js"), "export const semver = true;\n", "utf8");
    await mkdir(path.dirname(standaloneMissingLink), { recursive: true });
    await symlink("../semver@6.3.1/node_modules/semver", standaloneMissingLink, "dir");

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

    expect((await lstat(copiedStandaloneTarget)).isSymbolicLink()).toBe(false);
    expect((await lstat(copiedFallbackTarget)).isSymbolicLink()).toBe(false);
    await expect(readFile(path.join(copiedStandaloneTarget, "index.js"), "utf8")).resolves.toContain("sharp = true");
    await expect(readFile(path.join(copiedFallbackTarget, "index.js"), "utf8")).resolves.toContain("semver = true");
  });

  it("stages Next.js standalone symlinks that resolve through the monorepo root", async () => {
    const { stageNextjsStandaloneArtifact } = await import("../src/lib/app/preview-build");
    const cwd = await createTempCwd();
    const repoRoot = path.join(cwd, "repo");
    const appPath = path.join(repoRoot, "apps", "web");
    const standaloneDir = path.join(appPath, ".next", "standalone");
    const artifactDir = path.join(cwd, "artifact");
    const rootDependency = path.join(repoRoot, "node_modules", "pg");
    const standaloneLink = path.join(standaloneDir, "node_modules", "pg");

    await mkdir(path.join(repoRoot, ".git"), { recursive: true });
    await mkdir(rootDependency, { recursive: true });
    await writeFile(path.join(rootDependency, "index.js"), "export const pg = true;\n", "utf8");
    await mkdir(path.dirname(standaloneLink), { recursive: true });
    await symlink(path.relative(path.dirname(standaloneLink), rootDependency), standaloneLink, "dir");

    await stageNextjsStandaloneArtifact({
      standaloneDir,
      artifactDir,
      appPath,
    });

    const copiedDependency = path.join(artifactDir, "node_modules", "pg");

    expect((await lstat(copiedDependency)).isSymbolicLink()).toBe(false);
    await expect(readFile(path.join(copiedDependency, "index.js"), "utf8")).resolves.toContain("pg = true");
  });

  it("keeps pnpm transitive dependencies resolvable after flattening Next.js standalone packages", async () => {
    const { stageNextjsStandaloneArtifact } = await import("../src/lib/app/preview-build");
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

    await mkdir(path.join(nextStorePackage, "dist/shared/lib"), { recursive: true });
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
    await symlink("../../@swc+helpers@0.5.15/node_modules/@swc/helpers", swcHoistedLink, "dir");

    await stageNextjsStandaloneArtifact({
      standaloneDir,
      artifactDir,
      appPath,
    });

    const constants = path.join(artifactDir, "node_modules/next/dist/shared/lib/constants.js");
    const requireFromNext = createRequire(constants);

    expect(() => requireFromNext.resolve("@swc/helpers/_/_interop_require_default")).not.toThrow();
  });

  it("places public and .next/static next to server.js when the entrypoint is nested (monorepo)", async () => {
    const { restageNextjsArtifact } = await import("../src/lib/app/preview-build");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "repo", "apps", "web");
    const standaloneDir = path.join(appPath, ".next", "standalone");
    const nestedServerDir = path.join(standaloneDir, "apps", "web");
    const artifactDir = path.join(cwd, "artifact");

    await mkdir(path.join(cwd, "repo", ".git"), { recursive: true });
    await mkdir(nestedServerDir, { recursive: true });
    await writeFile(path.join(nestedServerDir, "server.js"), "// nested server\n", "utf8");
    await mkdir(path.join(standaloneDir, "node_modules"), { recursive: true });

    await mkdir(path.join(appPath, "public"), { recursive: true });
    await writeFile(path.join(appPath, "public", "hello.txt"), "hello\n", "utf8");
    await mkdir(path.join(appPath, ".next", "static"), { recursive: true });
    await writeFile(path.join(appPath, ".next", "static", "client.js"), "// static\n", "utf8");

    // Seed an existing (incorrect) artifact directory to mirror what the SDK
    // produces before the CLI re-stages it.
    await mkdir(artifactDir, { recursive: true });

    await restageNextjsArtifact(
      { directory: artifactDir, entrypoint: "apps/web/server.js" },
      appPath,
    );

    await expect(
      readFile(path.join(artifactDir, "apps", "web", "public", "hello.txt"), "utf8"),
    ).resolves.toContain("hello");
    await expect(
      readFile(path.join(artifactDir, "apps", "web", ".next", "static", "client.js"), "utf8"),
    ).resolves.toContain("static");
  });

  it("rejects Next.js standalone symlinks that escape the app directory", async () => {
    const { stageNextjsStandaloneArtifact } = await import("../src/lib/app/preview-build");
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "app");
    const standaloneDir = path.join(appPath, ".next", "standalone");
    const artifactDir = path.join(cwd, "artifact");
    const escapeTarget = path.join(cwd, "escape");
    const escapeLink = path.join(standaloneDir, "node_modules/escape");

    await mkdir(escapeTarget, { recursive: true });
    await writeFile(path.join(escapeTarget, "index.js"), "export const escaped = true;\n", "utf8");
    await mkdir(path.dirname(escapeLink), { recursive: true });
    await symlink(escapeTarget, escapeLink, "dir");

    await expect(stageNextjsStandaloneArtifact({
      standaloneDir,
      artifactDir,
      appPath,
    })).rejects.toThrow("escapes the app directory");
  });
});
