import { describe, expect, it } from "vitest";

import {
  cliGroups,
  mountedCommands,
  platformCommandFamily,
} from "../src/v8/cli";
import { telemetryDisableCommand } from "../src/v8/telemetry/disable";
import { telemetryEnableCommand } from "../src/v8/telemetry/enable";
import { telemetryStatusCommand } from "../src/v8/telemetry/status";
import { versionCommand } from "../src/v8/version";

const SHELL_OWNED: ReadonlySet<unknown> = new Set([
  telemetryStatusCommand,
  telemetryEnableCommand,
  telemetryDisableCommand,
  versionCommand,
]);

/**
 * Every path the v8 tree mounts, written out. The other assertions in
 * this file compare the two maps only to each other, so deleting a
 * command from both leaves them green; this is the one that fails when a
 * command goes missing or its path is misspelled. Adding a command means
 * adding its path here.
 */
const EXPECTED_MOUNT_PATHS: readonly string[] = [
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
  "telemetry disable",
  "telemetry enable",
  "telemetry status",
  "version",
];

describe("prisma-v8 mount coverage", () => {
  it("mounts exactly the expected command paths", () => {
    expect(Object.keys(mountedCommands).sort()).toEqual(EXPECTED_MOUNT_PATHS);
  });

  it("mounts every command in the platform family", () => {
    const mounted = new Set(Object.values(mountedCommands));
    const unmounted = Object.entries(platformCommandFamily.commands)
      .filter(([, command]) => !mounted.has(command))
      .map(([key]) => key);

    expect(unmounted).toEqual([]);
  });

  it("gives every mounted command a family, except the shell-owned ones", () => {
    const family = new Set(Object.values(platformCommandFamily.commands));
    const unowned = Object.entries(mountedCommands)
      .filter(
        ([, command]) => !family.has(command) && !SHELL_OWNED.has(command),
      )
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
