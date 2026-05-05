import { chmod, lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
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
