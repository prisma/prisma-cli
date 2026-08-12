import { telemetryCommandGroup } from "@prisma/cli-engine";
import { describe, expect, it } from "vitest";
import { CLI_DOCS_URL } from "../src/cli-name";
import { agentInstallCommand } from "../src/v8/agent/install";
import { agentStatusCommand } from "../src/v8/agent/status";
import { agentUpdateCommand } from "../src/v8/agent/update";
import {
  cliGroups,
  composerCommandFamily,
  mountedCommands,
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
  "feedback",
  "git connect",
  "git disconnect",
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
  "service create",
  "service deployment list",
  "service deployment promote",
  "service deployment rollback",
  "service deployment show",
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
};

describe("prisma-v8 mount coverage", () => {
  it("mounts exactly the expected command paths", () => {
    expect(Object.keys(mountedCommands).sort()).toEqual(EXPECTED_MOUNT_PATHS);
  });

  it.each(
    Object.entries(MOUNTED_FAMILIES),
  )("mounts every command in the %s family", (_name, commandFamily) => {
    const mounted = new Set(Object.values(mountedCommands));
    const unmounted = Object.entries(commandFamily.commands)
      .filter(([, command]) => !mounted.has(command))
      .map(([key]) => key);

    expect(unmounted).toEqual([]);
  });

  it("gives every mounted command a family, except the deliberately familyless ones", () => {
    const owned = new Set(
      Object.values(MOUNTED_FAMILIES).flatMap((commandFamily) =>
        Object.values(commandFamily.commands),
      ),
    );
    const unowned = Object.entries(mountedCommands)
      .filter(([, command]) => !owned.has(command) && !FAMILYLESS.has(command))
      .map(([path]) => path);

    expect(unowned).toEqual([]);
  });

  it("declares a group for every mount path prefix", () => {
    const missing = Object.keys(mountedCommands)
      .map((path) => path.split(" ").slice(0, -1).join(" "))
      .filter((group) => group.length > 0 && !(group in cliGroups));

    expect(missing).toEqual([]);
  });
});
