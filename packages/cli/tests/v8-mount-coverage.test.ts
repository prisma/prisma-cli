import { describe, expect, it } from "vitest";

import {
  cliGroups,
  mountedCommands,
  platformCommandFamily,
} from "../src/v8/cli";
import { telemetryDisableCommand } from "../src/v8/telemetry/disable";
import { telemetryEnableCommand } from "../src/v8/telemetry/enable";
import { telemetryStatusCommand } from "../src/v8/telemetry/status";

const SHELL_OWNED: ReadonlySet<unknown> = new Set([
  telemetryStatusCommand,
  telemetryEnableCommand,
  telemetryDisableCommand,
]);

describe("prisma-v8 mount coverage", () => {
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
