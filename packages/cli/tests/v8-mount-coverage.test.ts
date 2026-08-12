/**
 * The grammar completeness check. It runs in the test suite and, as
 * `pnpm check:grammar`, in `pr-quality.yml` and in `publish.yml` before
 * anything is published, so a tree that has lost a command cannot be
 * released.
 *
 * The exception set below (the engine's three telemetry commands,
 * `agent install|update|status`, and `feedback`) was ratified by the
 * operator on 2026-08-12. Adding to it requires an operator ruling
 * recorded here; giving those commands a real owning family, so the
 * exception set can shrink, is deferred work.
 */
import type { AnyCommand, CommandFamily } from "@prisma/cli-engine";
import { defineCommand, telemetryCommandGroup } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { describe, expect, it } from "vitest";
import { CLI_DOCS_URL } from "../src/cli-name";
import { agentInstallCommand } from "../src/v8/agent/install";
import { agentStatusCommand } from "../src/v8/agent/status";
import { agentUpdateCommand } from "../src/v8/agent/update";
import {
  cliGroups,
  composerCommandFamily,
  mountedCommands,
  ormCommandFamily,
  platformCommandFamily,
} from "../src/v8/cli";
import { feedbackCommand } from "../src/v8/feedback";

/**
 * Commands that deliberately belong to no family: the engine's consent
 * surface, which cli.ts spreads in whole, and the local utilities that
 * contribute no config section and call no API.
 */
const FAMILYLESS: ReadonlySet<unknown> = new Set([
  ...Object.values(telemetryCommandGroup({ docsUrl: CLI_DOCS_URL }).commands),
  agentInstallCommand,
  agentUpdateCommand,
  agentStatusCommand,
  feedbackCommand,
]);

/** The family commands the tree does not mount, by family key. */
function unmountedFamilyCommands(
  commandFamily: Pick<CommandFamily, "commands">,
  tree: Readonly<Record<string, AnyCommand>>,
): readonly string[] {
  const mounted = new Set<unknown>(Object.values(tree));
  return Object.entries(commandFamily.commands)
    .filter(([, command]) => !mounted.has(command))
    .map(([key]) => key);
}

/** The mounted paths no family owns and no exception excuses. */
function unownedMountPaths(
  tree: Readonly<Record<string, AnyCommand>>,
  families: readonly Pick<CommandFamily, "commands">[],
  excepted: ReadonlySet<unknown>,
): readonly string[] {
  const owned = new Set<unknown>(
    families.flatMap((commandFamily) => Object.values(commandFamily.commands)),
  );
  return Object.entries(tree)
    .filter(([, command]) => !owned.has(command) && !excepted.has(command))
    .map(([path]) => path);
}

/**
 * Every path the v8 tree mounts, written out. The other assertions in
 * this file compare the two maps only to each other, so deleting a
 * command from both leaves them green; this is the one that fails when a
 * command goes missing or its path is misspelled. Adding a command means
 * adding its path here.
 */
const EXPECTED_MOUNT_PATHS: readonly string[] = [
  "agent install",
  "agent status",
  "agent update",
  "auth login",
  "auth logout",
  "auth whoami",
  "auth workspace list",
  "auth workspace logout",
  "auth workspace use",
  "branch list",
  "bucket create",
  "bucket delete",
  "bucket key create",
  "bucket key delete",
  "bucket key list",
  "bucket list",
  "build logs",
  "composer deploy",
  "composer destroy",
  "composer dev",
  "composer log",
  "contract emit",
  "contract infer",
  "db init",
  "db schema",
  "db sign",
  "db update",
  "db verify",
  "feedback",
  "format",
  "git connect",
  "git disconnect",
  "init",
  "lsp",
  "migrate",
  "migration check",
  "migration graph",
  "migration list",
  "migration log",
  "migration new",
  "migration plan",
  "migration show",
  "migration status",
  "postgres backup list",
  "postgres connection create",
  "postgres connection list",
  "postgres connection remove",
  "postgres connection rotate",
  "postgres create",
  "postgres list",
  "postgres remove",
  "postgres restore",
  "postgres show",
  "postgres usage",
  "project create",
  "project env add",
  "project env list",
  "project env remove",
  "project env update",
  "project link",
  "project list",
  "project remove",
  "project rename",
  "project show",
  "project transfer",
  "ref delete",
  "ref list",
  "ref set",
  "service create",
  "service deployment delete",
  "service deployment list",
  "service deployment promote",
  "service deployment rollback",
  "service deployment show",
  "service deployment start",
  "service deployment stop",
  "service domain add",
  "service domain remove",
  "service domain retry",
  "service domain show",
  "service domain wait",
  "service list",
  "service open",
  "service remove",
  "service show",
  "telemetry disable",
  "telemetry enable",
  "telemetry status",
];

const MOUNTED_FAMILIES = {
  platform: platformCommandFamily,
  composer: composerCommandFamily,
  orm: ormCommandFamily,
};

describe("prisma-v8 mount coverage", () => {
  it("mounts exactly the expected command paths", () => {
    expect(Object.keys(mountedCommands).sort()).toEqual(EXPECTED_MOUNT_PATHS);
  });

  it.each(
    Object.entries(MOUNTED_FAMILIES),
  )("mounts every command in the %s family", (_name, commandFamily) => {
    expect(unmountedFamilyCommands(commandFamily, mountedCommands)).toEqual([]);
  });

  it("gives every mounted command a family, except the deliberately familyless ones", () => {
    expect(
      unownedMountPaths(
        mountedCommands,
        Object.values(MOUNTED_FAMILIES),
        FAMILYLESS,
      ),
    ).toEqual([]);
  });

  it("declares a group for every mount path prefix", () => {
    const missing = Object.keys(mountedCommands)
      .map((path) => path.split(" ").slice(0, -1).join(" "))
      .filter((group) => group.length > 0 && !(group in cliGroups));

    expect(missing).toEqual([]);
  });
});

/**
 * The check's own failure behaviour, on constructed families and trees
 * rather than the real mount: if these comparisons stopped reporting,
 * the assertions above would pass on a tree that had lost a command.
 */
describe("the completeness comparisons report what is wrong", () => {
  const toy = (summary: string): AnyCommand =>
    defineCommand({
      help: { summary },
      handler: async (_args, ctx) =>
        ok(ctx.present({ data: null, exitCode: 0 }, { human: () => [] })),
    });

  const kept = toy("kept");
  const dropped = toy("dropped");
  const stray = toy("stray");
  const excused = toy("excused");
  const family = { commands: { kept, dropped } };

  it("names a family command that the tree does not mount", () => {
    expect(unmountedFamilyCommands(family, { kept })).toEqual(["dropped"]);
  });

  it("says nothing when the tree mounts the whole family", () => {
    expect(unmountedFamilyCommands(family, { kept, dropped })).toEqual([]);
  });

  it("names a mounted command that no family owns", () => {
    expect(
      unownedMountPaths({ kept, "toy stray": stray }, [family], new Set()),
    ).toEqual(["toy stray"]);
  });

  it("excuses a mounted command in the exception set", () => {
    expect(
      unownedMountPaths({ kept, excused }, [family], new Set([excused])),
    ).toEqual([]);
  });
});
