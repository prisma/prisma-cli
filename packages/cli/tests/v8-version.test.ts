/**
 * The v8 `version` command: semantic assertions on the envelope, the
 * presented data and the exit code.
 */
import { createTestCli } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readCliVersion } from "../src/lib/version";
import { buildVersionResult, versionCommand } from "../src/v8/version";

vi.mock("../src/lib/version", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/version")>()),
  readCliVersion: vi.fn(),
}));

const COMMANDS = { version: versionCommand };

type ResultFrame = {
  readonly kind: string;
  readonly envelope: {
    readonly ok: boolean;
    readonly error?: Record<string, unknown>;
    readonly result?: unknown;
  };
};

function envelopeOf(result: { readonly json: readonly unknown[] }) {
  const frame = (result.json as readonly ResultFrame[]).find(
    (candidate) => candidate.kind === "result",
  );
  if (frame === undefined) {
    throw new Error("expected a terminal result frame");
  }
  return frame.envelope;
}

beforeEach(() => {
  vi.mocked(readCliVersion).mockReturnValue("8.0.0-rc.1");
});

describe("version", () => {
  it("reports the cli, node and os facts", async () => {
    const cli = createTestCli({ commands: COMMANDS });

    const result = await cli.run(["version"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      cli: { name: "prisma-cli", version: "8.0.0-rc.1" },
      node: { version: process.version },
      os: { platform: process.platform, arch: process.arch },
    });
  });

  it("carries the same fields in the json envelope", async () => {
    const cli = createTestCli({ commands: COMMANDS });

    const result = await cli.run(["version", "--format", "json"]);

    const envelope = envelopeOf(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.result).toEqual({
      cli: { name: "prisma-cli", version: "8.0.0-rc.1" },
      node: { version: process.version },
      os: { platform: process.platform, arch: process.arch },
    });
  });

  it("writes the fields to stdout as machine-readable lines", async () => {
    const cli = createTestCli({ commands: COMMANDS });

    const result = await cli.run(["version"], {
      isTty: { stdout: true, stderr: true },
    });

    expect(result.stdout).toContain("prisma-cli: 8.0.0-rc.1");
    expect(result.stdout).toContain(`node: ${process.version}`);
    expect(result.stdout).toContain(`os: ${process.platform} ${process.arch}`);
  });

  it("errors when the bundled package carries no version", async () => {
    vi.mocked(readCliVersion).mockReturnValue(undefined);
    const cli = createTestCli({ commands: COMMANDS });

    const result = await cli.run(["version", "--format", "json"]);

    expect(result.exitCode).toBe(2);
    const envelope = envelopeOf(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe("VERSION.UNAVAILABLE");
  });
});

describe("buildVersionResult", () => {
  it("reports the host it is given rather than the running process", () => {
    expect(
      buildVersionResult({
        version: "v22.12.0",
        platform: "linux",
        arch: "arm64",
      }),
    ).toEqual({
      cli: { name: "prisma-cli", version: "8.0.0-rc.1" },
      node: { version: "v22.12.0" },
      os: { platform: "linux", arch: "arm64" },
    });
  });
});
