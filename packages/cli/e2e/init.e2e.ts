/**
 * `prisma init` needs no credential: it edits package.json, scaffolds
 * prisma.config.ts and syncs skills from installed packages, so it runs
 * here whether or not the real-API suite has a token. Covered as an
 * e2e-coverage EXCLUSIONS entry, because `describeCommand` skips
 * without credentials and this must not.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "@prisma/cli-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLI_BINARY } from "./harness";

const execFileAsync = promisify(execFile);

/** The built `prisma` package, so the scaffold's `prisma/config` import
 *  resolves in the fixture exactly as it does in a user project. */
const PRISMA_PACKAGE_DIR = path.resolve(import.meta.dirname, "../../prisma");

interface InitEnvelope {
  readonly ok: boolean;
  readonly diagnostics: readonly { readonly code: string }[];
  readonly result: {
    readonly postinstall: {
      readonly outcome: string;
      readonly script: string | null;
      readonly dependency: string;
    };
    readonly config: {
      readonly outcome: string;
      readonly agents: readonly string[] | null;
    };
    readonly skills: {
      readonly outcome: string;
      readonly sync: { readonly packages: readonly unknown[] } | null;
    };
  };
}

async function runInit(
  cwd: string,
  argv: readonly string[] = [],
): Promise<InitEnvelope> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [CLI_BINARY, "init", "--json", ...argv],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        HOME: cwd,
        USERPROFILE: cwd,
        PRISMA_NEXT_DISABLE_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
        CI: "1",
      },
      timeout: 60_000,
    },
  );
  const frames = stdout
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as { kind?: string; envelope?: unknown });
  const result = frames.reverse().find((frame) => frame.kind === "result");
  if (result?.envelope === undefined) {
    throw new Error(`no terminal result frame in:\n${stdout.slice(0, 2000)}`);
  }
  return result.envelope as InitEnvelope;
}

describe("prisma init", () => {
  let workdir: string;

  beforeAll(async () => {
    if (!existsSync(path.join(PRISMA_PACKAGE_DIR, "dist", "config.js"))) {
      throw new Error(
        "packages/prisma is not built; run `pnpm --filter prisma build` before the e2e suite so the scaffold's prisma/config import can resolve.",
      );
    }
    workdir = await mkdtemp(path.join(os.tmpdir(), "prisma-e2e-init-"));
    await writeFile(
      path.join(workdir, "package.json"),
      `${JSON.stringify({ name: "e2e-init-fixture", version: "0.0.0" }, null, 2)}\n`,
      "utf8",
    );
    // The install a user project would have: node_modules/prisma
    // resolving to the built package.
    await mkdir(path.join(workdir, "node_modules"), { recursive: true });
    await symlink(
      PRISMA_PACKAGE_DIR,
      path.join(workdir, "node_modules", "prisma"),
      "dir",
    );
  });

  afterAll(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("adds the postinstall hook, scaffolds the config, and finds no skills to sync", async () => {
    const envelope = await runInit(workdir);

    expect(envelope.ok).toBe(true);
    expect(envelope.result.postinstall.outcome).toBe("added");
    expect(envelope.result.postinstall.script).toBe(
      "prisma skills sync || exit 0",
    );
    // The fixture's node_modules carries prisma via a symlink, but its
    // package.json declares nothing, so init records the dependency.
    expect(envelope.result.postinstall.dependency).toBe("added");
    expect(envelope.result.config.outcome).toBe("created");
    expect(envelope.result.config.agents).toEqual([
      "claude",
      "cursor",
      "agents",
      "devin",
    ]);
    // No allowlisted Prisma package is installed here, so the sync has
    // nothing to do and says so instead of failing.
    expect(envelope.result.skills.outcome).toBe("no-packages");
    expect(envelope.result.skills.sync?.packages).toEqual([]);
    expect(envelope.diagnostics).toEqual([]);

    const manifest = JSON.parse(
      await readFile(path.join(workdir, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.scripts?.postinstall).toBe("prisma skills sync || exit 0");
    const cliManifest = JSON.parse(
      await readFile(
        path.resolve(import.meta.dirname, "..", "package.json"),
        "utf8",
      ),
    ) as { version: string };
    expect(manifest.devDependencies).toEqual({ prisma: cliManifest.version });
  });

  it("records --skills=none as an empty agents list and syncs nothing", async () => {
    const noneDir = await mkdtemp(path.join(os.tmpdir(), "prisma-e2e-none-"));
    await writeFile(
      path.join(noneDir, "package.json"),
      `${JSON.stringify({ name: "e2e-none-fixture", version: "0.0.0" }, null, 2)}\n`,
      "utf8",
    );
    const envelope = await runInit(noneDir, ["--skills=none"]);

    expect(envelope.ok).toBe(true);
    expect(envelope.result.config.outcome).toBe("created");
    expect(envelope.result.skills.outcome).toBe("skipped");
    expect(envelope.diagnostics).toEqual([]);
    const scaffold = await readFile(
      path.join(noneDir, "prisma.config.ts"),
      "utf8",
    );
    expect(scaffold).toContain("agents: [],");
    for (const dir of [".claude", ".cursor", ".agents", ".devin"]) {
      expect(existsSync(path.join(noneDir, dir))).toBe(false);
    }
    await rm(noneDir, { recursive: true, force: true });
  });

  it("scaffolds a config the engine's real loader accepts without diagnostics", async () => {
    // The full round trip: the file init wrote, evaluated by the same
    // loader every command uses, importing definePrismaConfig through
    // the published prisma/config subpath.
    const loaded = await loadConfig(workdir);

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.files[0]?.sections.skills).toEqual({
      agents: ["claude", "cursor", "agents", "devin"],
    });
  });

  // The binary evaluates the scaffold it wrote in the first test: the
  // engine imports c12 via its realpath, so the pnpm development
  // layout that once broke this rerun ("Cannot find package 'pathe'")
  // no longer does.
  it("reruns safely over its own scaffold: every step reports already done", async () => {
    const envelope = await runInit(workdir);

    expect(envelope.ok).toBe(true);
    expect(envelope.result.postinstall.outcome).toBe("exists");
    expect(envelope.result.postinstall.dependency).toBe("declared");
    expect(envelope.result.config.outcome).toBe("exists");
    expect(envelope.result.skills.outcome).toBe("no-packages");
    expect(envelope.diagnostics).toEqual([]);
  });

  it("below an ancestor config, init scaffolds only and skips the root-level steps", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "prisma-e2e-subinit-"));
    await mkdir(path.join(repo, ".git"));
    await writeFile(
      path.join(repo, "prisma.config.ts"),
      "export default { $prismaConfig: 1 };\n",
      "utf8",
    );
    const nested = path.join(repo, "packages", "db");
    await mkdir(nested, { recursive: true });
    await writeFile(
      path.join(nested, "package.json"),
      `${JSON.stringify({ name: "e2e-sub-fixture", version: "0.0.0" }, null, 2)}\n`,
      "utf8",
    );

    const envelope = await runInit(nested);

    expect(envelope.ok).toBe(true);
    expect(envelope.result.postinstall).toEqual({
      outcome: "skipped",
      script: null,
      dependency: "skipped",
    });
    expect(envelope.result.skills.outcome).toBe("skipped");
    expect(envelope.result.config.outcome).toBe("created");
    expect(envelope.diagnostics).toEqual([]);
    const manifest = JSON.parse(
      await readFile(path.join(nested, "package.json"), "utf8"),
    ) as { scripts?: unknown; devDependencies?: unknown };
    expect(manifest.scripts).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
    expect(existsSync(path.join(nested, "prisma.config.ts"))).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });
});
