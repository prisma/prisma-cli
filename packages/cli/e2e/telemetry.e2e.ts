/**
 * Telemetry consent is local state rather than an API resource, but the
 * commands still ship in the binary, so they get the same happy path.
 * Each run has its own HOME, so the config these write is thrown away
 * with the session.
 */
import { expect, it } from "vitest";

import { describeCommand, session } from "./suite";

/**
 * These read and write real consent state, so they must not inherit the
 * suite-wide opt-out that keeps the rest of the run silent. CI is
 * cleared too: CI detection disables telemetry on its own, which would
 * make `status` report "off" whatever the stored consent said, and the
 * assertions below would then pass without the command having worked.
 */
const CONSENT_WRITABLE = {
  PRISMA_NEXT_DISABLE_TELEMETRY: undefined,
  DO_NOT_TRACK: undefined,
  CI: undefined,
} as const;

interface TelemetryStatus {
  readonly enabled: boolean;
  readonly reason?: string;
}

describeCommand("telemetry status", () => {
  it("reports the consent state and where it is stored", async () => {
    const cli = await session();
    const cwd = await cli.workdir();
    const run = await cli.run(["telemetry", "status"], { cwd });
    const status = run.envelope.result as TelemetryStatus & {
      readonly configPath: string;
    };

    expect(run.exitCode).toBe(0);
    expect(typeof status.enabled).toBe("boolean");
    expect(status.reason).toBeTruthy();
    // The suite gives every run its own HOME, so the config it reports
    // must sit inside that HOME rather than the developer's own.
    expect(status.configPath).toContain("prisma-e2e-home-");
  });
});

describeCommand("telemetry disable", () => {
  it("turns telemetry off and status agrees", async () => {
    const cli = await session();
    const cwd = await cli.workdir();

    const run = await cli.run(["telemetry", "disable"], {
      cwd,
      env: CONSENT_WRITABLE,
    });
    expect(run.envelope.ok).toBe(true);

    const status = await cli.run(["telemetry", "status"], {
      cwd,
      env: CONSENT_WRITABLE,
    });
    expect((status.envelope.result as TelemetryStatus).enabled).toBe(false);
  });
});

describeCommand("telemetry enable", () => {
  it("turns telemetry back on and status agrees", async () => {
    const cli = await session();
    const cwd = await cli.workdir();

    // Disable first, so a passing assertion means this command changed
    // the state rather than finding the default already on.
    const run0 = await cli.run(["telemetry", "disable"], {
      cwd,
      env: CONSENT_WRITABLE,
    });
    expect(run0.envelope.ok).toBe(true);

    const run = await cli.run(["telemetry", "enable"], {
      cwd,
      env: CONSENT_WRITABLE,
    });
    expect(run.envelope.ok).toBe(true);

    const status = await cli.run(["telemetry", "status"], {
      cwd,
      env: CONSENT_WRITABLE,
    });
    expect((status.envelope.result as TelemetryStatus).enabled).toBe(true);
  });
});
