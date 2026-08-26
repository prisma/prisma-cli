import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLocalResolutionPin } from "../src/lib/project/local-pin";
import { findNearestPrismaDir } from "../src/lib/project/prisma-dir";
import { resolveStateDir } from "../src/state-dir";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "prisma-dir-anchor-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function writePin(
  dir: string,
  pin: { workspaceId: string; projectId: string },
): Promise<void> {
  await mkdir(path.join(dir, ".prisma"), { recursive: true });
  await writeFile(
    path.join(dir, ".prisma", "local.json"),
    `${JSON.stringify(pin, null, 2)}\n`,
    "utf8",
  );
}

describe("findNearestPrismaDir", () => {
  it("finds the nearest ancestor with a .prisma directory", async () => {
    const root = await createTempDir();
    const cwd = path.join(root, "apps", "api", "src");
    await mkdir(path.join(root, ".prisma"), { recursive: true });
    await mkdir(cwd, { recursive: true });

    expect(await findNearestPrismaDir(cwd)).toBe(root);
  });

  it("prefers the nearest .prisma over a higher one", async () => {
    const root = await createTempDir();
    const nested = path.join(root, "apps", "api");
    const cwd = path.join(nested, "src");
    await mkdir(path.join(root, ".prisma"), { recursive: true });
    await mkdir(path.join(nested, ".prisma"), { recursive: true });
    await mkdir(cwd, { recursive: true });

    expect(await findNearestPrismaDir(cwd)).toBe(nested);
  });

  it("ignores a .prisma that is a file, not a directory", async () => {
    const root = await createTempDir();
    const cwd = path.join(root, "apps");
    await mkdir(cwd, { recursive: true });
    await writeFile(path.join(cwd, ".prisma"), "", "utf8");
    await mkdir(path.join(root, ".prisma"), { recursive: true });

    expect(await findNearestPrismaDir(cwd)).toBe(root);
  });
});

describe("readLocalResolutionPin discovery", () => {
  it("finds the pin from a subdirectory of the linked directory", async () => {
    const root = await createTempDir();
    const cwd = path.join(root, "apps", "api");
    await mkdir(cwd, { recursive: true });
    await writePin(root, { workspaceId: "ws-1", projectId: "prj-1" });

    const result = await readLocalResolutionPin(cwd);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      kind: "present",
      pin: { workspaceId: "ws-1", projectId: "prj-1" },
      directory: root,
    });
  });

  it("reads the nearest pin when an ancestor also has one", async () => {
    const root = await createTempDir();
    const nested = path.join(root, "apps", "api");
    const cwd = path.join(nested, "src");
    await mkdir(cwd, { recursive: true });
    await writePin(root, { workspaceId: "ws-root", projectId: "prj-root" });
    await writePin(nested, { workspaceId: "ws-near", projectId: "prj-near" });

    const result = await readLocalResolutionPin(cwd);
    expect(result.unwrap()).toEqual({
      kind: "present",
      pin: { workspaceId: "ws-near", projectId: "prj-near" },
      directory: nested,
    });
  });

  it("reports missing when no .prisma exists anywhere up the tree", async () => {
    const root = await createTempDir();
    const cwd = path.join(root, "apps", "api");
    await mkdir(cwd, { recursive: true });

    const result = await readLocalResolutionPin(cwd);
    expect(result.unwrap()).toEqual({ kind: "missing" });
  });

  it("stops at a nearer .prisma directory that has no pin file", async () => {
    const root = await createTempDir();
    const nested = path.join(root, "apps", "api");
    await mkdir(path.join(nested, ".prisma"), { recursive: true });
    await writePin(root, { workspaceId: "ws-root", projectId: "prj-root" });

    const result = await readLocalResolutionPin(nested);
    expect(result.unwrap()).toEqual({ kind: "missing" });
  });
});

describe("resolveStateDir anchoring", () => {
  const signal = new AbortController().signal;

  it("anchors the state dir at the nearest .prisma directory", async () => {
    const root = await createTempDir();
    const cwd = path.join(root, "apps", "api");
    await mkdir(path.join(root, ".prisma"), { recursive: true });
    await mkdir(cwd, { recursive: true });

    expect(await resolveStateDir({ env: {}, cwd, signal })).toBe(
      path.join(root, ".prisma", "cli"),
    );
  });

  it("uses the same nearest-wins anchor as pin reads", async () => {
    const root = await createTempDir();
    const nested = path.join(root, "apps", "api");
    const cwd = path.join(nested, "src");
    await mkdir(path.join(root, ".prisma"), { recursive: true });
    await mkdir(path.join(nested, ".prisma"), { recursive: true });
    await mkdir(cwd, { recursive: true });

    expect(await resolveStateDir({ env: {}, cwd, signal })).toBe(
      path.join(nested, ".prisma", "cli"),
    );
  });

  it("lets the explicit flag and env variable win over the anchor", async () => {
    const root = await createTempDir();
    await mkdir(path.join(root, ".prisma"), { recursive: true });

    expect(
      await resolveStateDir({
        stateDir: "/explicit/state",
        env: {},
        cwd: root,
        signal,
      }),
    ).toBe("/explicit/state");
    expect(
      await resolveStateDir({
        env: { PRISMA_CLI_STATE_DIR: "/env/state" },
        cwd: root,
        signal,
      }),
    ).toBe("/env/state");
  });

  it("falls back to cwd when no .prisma or compute config exists", async () => {
    const root = await createTempDir();
    const cwd = path.join(root, "apps", "api");
    await mkdir(cwd, { recursive: true });

    expect(await resolveStateDir({ env: {}, cwd, signal })).toBe(
      path.join(cwd, ".prisma", "cli"),
    );
  });
});
