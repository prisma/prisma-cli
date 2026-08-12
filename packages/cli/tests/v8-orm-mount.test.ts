/**
 * The ORM family, mounted in this shell: the same command objects and
 * groups the bin builds, run through the engine's test harness. What is
 * proven here is the mount, not orm-toolchain's command logic — that a
 * user typing `prisma migration list` reaches a real ORM handler, that
 * the family's config section and redirect table came along with it,
 * and that the four new groups are named in the root help.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";
import {
  cliGroups,
  composerCommandFamily,
  mountedCommands,
  ormCommandFamily,
  platformCommandFamily,
} from "../src/v8/cli";

/** A project directory with a real (empty) migrations directory, so
 *  `migration list` reads the disk rather than reporting its absence. */
const ORM_PROJECT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "v8-orm-project",
);

/**
 * The smallest `orm` section orm-toolchain's validator accepts: a
 * family, a target and an adapter descriptor, plus the migrations
 * directory. `migration list` reads only the last of those; the other
 * three exist because the section is validated whole before any ORM
 * command runs, which is itself part of what this file proves.
 */
const ORM_SECTION = {
  family: {
    kind: "family",
    id: "test-family",
    familyId: "test-family",
    version: "0.0.0",
    emission: {},
    create: () => ({}),
  },
  target: descriptor("target"),
  adapter: descriptor("adapter"),
  migrations: { dir: "migrations" },
};

function descriptor(kind: string) {
  return {
    kind,
    id: `test-${kind}`,
    familyId: "test-family",
    version: "0.0.0",
    targetId: "test-target",
    create: () => ({}),
  };
}

function shell(config?: Readonly<Record<string, unknown>>) {
  return createTestCli({
    commandFamilies: [
      platformCommandFamily,
      composerCommandFamily,
      ormCommandFamily,
    ],
    commands: mountedCommands,
    groups: cliGroups,
    config,
    now: () => new Date(0),
  });
}

describe("the ORM family answers from the assembled tree", () => {
  it("runs migration list against a project directory", async () => {
    const result = await shell({ orm: ORM_SECTION }).run(
      ["migration", "list"],
      { cwd: ORM_PROJECT_DIR },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.presentation.json).toEqual({
      ok: true,
      spaces: [{ space: "app", migrations: [] }],
      summary: "0 migration(s) on disk",
    });
  });

  it("validates the family's config section before running a command", async () => {
    const result = await shell({}).run(["migration", "list", "--json"], {
      cwd: ORM_PROJECT_DIR,
    });

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored result frame");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONFIG_SECTION_INVALID");
    expect(frame.envelope.error.summary).toContain("'orm' section");
  });

  it("answers a retired invocation with the family's redirect", async () => {
    const result = await shell({ orm: ORM_SECTION }).run(
      ["migration", "apply", "--json"],
      { cwd: ORM_PROJECT_DIR },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored result frame");
    }
    expect(frame.envelope.error.code).toBe("CLI.COMMAND_MOVED");
    expect(frame.envelope.nextActions[0]).toMatchObject({
      kind: "run-command",
      command: "prisma-test migrate --to <contract>",
    });
  });

  it("names the four new groups in the root help", async () => {
    const result = await shell().run(["--help"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    for (const [group, { brief }] of Object.entries({
      contract: cliGroups.contract,
      db: cliGroups.db,
      migration: cliGroups.migration,
      ref: cliGroups.ref,
    })) {
      expect(result.stdout).toContain(group);
      expect(result.stdout).toContain(brief);
    }
  });
});
