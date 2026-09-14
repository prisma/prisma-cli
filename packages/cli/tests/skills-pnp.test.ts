/**
 * Yarn Plug'n'Play. A PnP project has no node_modules at all: packages
 * live inside zip archives, reachable only because `.pnp.cjs` patches
 * Node's resolver to answer with a path inside an archive and patches
 * the filesystem module to read such paths. This fixture does both of
 * those things, so it proves what PnP actually requires of the sync:
 * that it resolves packages through Node's resolver rather than by
 * building a node_modules path itself, and that it reads the source
 * tree through node:fs/promises rather than through an API the PnP
 * layer does not patch.
 */
import { mkdir, writeFile } from "node:fs/promises";
import Module from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const virtual = vi.hoisted(() => ({
  /** The shape a PnP path has: inside a zip, not inside node_modules. */
  prefix: "/pnp-virtual/.yarn/cache/prisma-orm-postgres-npm-8.4.0.zip",
  /** Where the bytes really are, once the fixture has made them. */
  realDir: "",
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const behind = (target: unknown): unknown => {
    if (typeof target !== "string") {
      return target;
    }
    // Production code routes paths through path.join, which uses
    // backslashes on Windows; the virtual prefix is declared with
    // forward slashes, so compare in forward-slash form.
    const asPosix = target.split(path.sep).join("/");
    return asPosix.startsWith(virtual.prefix)
      ? path.join(virtual.realDir, asPosix.slice(virtual.prefix.length))
      : target;
  };
  return {
    ...real,
    readFile: (target: unknown, ...rest: unknown[]) =>
      (real.readFile as (...args: unknown[]) => unknown)(
        behind(target),
        ...rest,
      ),
    readdir: (target: unknown, ...rest: unknown[]) =>
      (real.readdir as (...args: unknown[]) => unknown)(
        behind(target),
        ...rest,
      ),
    stat: (target: unknown, ...rest: unknown[]) =>
      (real.stat as (...args: unknown[]) => unknown)(behind(target), ...rest),
  };
});

const { isolateModuleResolution, makeProjectRoot, writeSkillTree } =
  await import("./helpers/skills-fixture");
const { readSkillsStatus } = await import("../src/lib/skills/status");
const { syncSkills } = await import("../src/lib/skills/sync");

isolateModuleResolution();

const PACKAGE = "@prisma/orm-postgres";
const VERSION = "8.4.0";
const packageRoot = `${virtual.prefix}/node_modules/${PACKAGE}`;

type ResolveFilename = (request: string, ...rest: unknown[]) => string;
let originalResolveFilename: ResolveFilename;

beforeAll(async () => {
  const store = path.join(
    await makeProjectRoot("pnp-store-"),
    "cache-contents",
  );
  virtual.realDir = store;
  const contents = path.join(store, "node_modules", PACKAGE);
  await mkdir(contents, { recursive: true });
  await writeFile(
    path.join(contents, "package.json"),
    `${JSON.stringify({ name: PACKAGE, version: VERSION }, null, 2)}\n`,
    "utf8",
  );
  await writeSkillTree(path.join(contents, "skills", "prisma-8"), {
    skill: "prisma-8",
    library: PACKAGE,
    version: VERSION,
  });

  const patched = Module as unknown as { _resolveFilename: ResolveFilename };
  originalResolveFilename = patched._resolveFilename;
  patched._resolveFilename = (request, ...rest) =>
    request === `${PACKAGE}/package.json`
      ? `${packageRoot}/package.json`
      : originalResolveFilename(request, ...rest);
});

afterAll(() => {
  (
    Module as unknown as { _resolveFilename: ResolveFilename }
  )._resolveFilename = originalResolveFilename;
});

describe("a Yarn PnP project", () => {
  it("installs the skill from inside the archive", async () => {
    const root = await makeProjectRoot("pnp-project-");

    const status = await readSkillsStatus(root);
    const outcome = await syncSkills(status);

    expect(status.packages).toEqual([
      {
        name: PACKAGE,
        version: VERSION,
        dir: packageRoot,
        conflictingVersions: [],
      },
    ]);
    expect(outcome.synced).toEqual([
      {
        skill: "prisma-8",
        library: PACKAGE,
        version: VERSION,
        dirs: [
          ".claude/skills",
          ".cursor/skills",
          ".agents/skills",
          ".devin/skills",
        ],
      },
    ]);
    const { readFile } = await import("node:fs/promises");
    expect(
      await readFile(
        path.join(root, ".claude/skills", "prisma-8", "SKILL.md"),
        "utf8",
      ),
    ).toContain(`library_version: ${VERSION}`);
    expect(
      await readFile(
        path.join(root, ".claude/skills", "prisma-8", "references", "usage.md"),
        "utf8",
      ),
    ).toContain(VERSION);
  });

  it("reports the copies as current on the next run", async () => {
    const root = await makeProjectRoot("pnp-project-");
    await syncSkills(await readSkillsStatus(root));

    const status = await readSkillsStatus(root);

    expect(status.upToDate).toBe(true);
  });
});
