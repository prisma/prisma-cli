/**
 * The package spec the CLI prints in its own hints. `latest` carries the
 * RC line since the 2026-08-25 cutover and the publish path no longer
 * moves `next` (docs/oss/versioning.md), so a hint spelling `@next`
 * installs a release that lags the current one.
 */
import { describe, expect, it } from "vitest";

import {
  formatPrismaCliCommand,
  PRISMA_CLI_PACKAGE_SPEC,
} from "../src/cli-command";
import { projectDeleteBlockedError } from "../src/lib/project/provider";

describe("formatPrismaCliCommand", () => {
  it("runs the package from the latest dist-tag", () => {
    expect(PRISMA_CLI_PACKAGE_SPEC).toBe("@prisma/cli@latest");
    expect(formatPrismaCliCommand(["skills", "sync"])).toBe(
      "npx -y @prisma/cli@latest skills sync",
    );
  });

  it("keeps the spec with a detected package runner", () => {
    expect(
      formatPrismaCliCommand(["skills", "sync"], {
        packageRunner: ["pnpm", "dlx"],
      }),
    ).toBe("pnpm dlx @prisma/cli@latest skills sync");
  });

  it("uses the binary name when asked for the binary", () => {
    expect(
      formatPrismaCliCommand(["skills", "sync"], { invocation: "binary" }),
    ).toBe("prisma skills sync");
  });
});

describe("projectDeleteBlockedError", () => {
  it("suggests a service delete command that runs the latest package", () => {
    const error = projectDeleteBlockedError("proj_1", undefined);

    expect(error.nextActions).toContainEqual({
      kind: "run-command",
      label: "npx -y @prisma/cli@latest service delete --service <name>",
      command: "npx -y @prisma/cli@latest service delete --service <name>",
    });
  });
});
