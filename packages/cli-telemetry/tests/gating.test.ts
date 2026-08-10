import { describe, expect, it } from "vitest";
import { resolveGating } from "../src/gating";

describe("resolveGating", () => {
  it("returns stored-opt-in when no CI/env override and stored enableTelemetry is true", () => {
    expect(
      resolveGating({
        env: {},
        config: { enableTelemetry: true },
        inCI: false,
      }),
    ).toEqual({ enabled: true, reason: "stored-opt-in" });
  });

  it("returns stored-opt-out when stored enableTelemetry is false", () => {
    expect(
      resolveGating({
        env: {},
        config: { enableTelemetry: false },
        inCI: false,
      }),
    ).toEqual({ enabled: false, reason: "stored-opt-out" });
  });

  it("returns default-on when enableTelemetry is undefined (opt-out default: file missing or field absent)", () => {
    expect(resolveGating({ env: {}, config: {}, inCI: false })).toEqual({
      enabled: true,
      reason: "default-on",
    });
  });

  it("returns ci ahead of every other signal, even a stored opt-in", () => {
    expect(
      resolveGating({ env: {}, config: { enableTelemetry: true }, inCI: true }),
    ).toEqual({ enabled: false, reason: "ci" });
  });

  it("returns ci over an env opt-out (CI is checked first)", () => {
    expect(
      resolveGating({
        env: { DO_NOT_TRACK: "1" },
        config: {},
        inCI: true,
      }),
    ).toEqual({ enabled: false, reason: "ci" });
  });

  it("returns env-opt-out when PRISMA_NEXT_DISABLE_TELEMETRY=1 overrides a true stored preference", () => {
    expect(
      resolveGating({
        env: { PRISMA_NEXT_DISABLE_TELEMETRY: "1" },
        config: { enableTelemetry: true },
        inCI: false,
      }),
    ).toEqual({ enabled: false, reason: "env-opt-out" });
  });

  it("treats any truthy value of PRISMA_NEXT_DISABLE_TELEMETRY as opt-out", () => {
    for (const value of ["1", "true", "yes", "on", "truthy-anything"]) {
      expect(
        resolveGating({
          env: { PRISMA_NEXT_DISABLE_TELEMETRY: value },
          config: { enableTelemetry: true },
          inCI: false,
        }).enabled,
      ).toBe(false);
    }
  });

  it('treats PRISMA_NEXT_DISABLE_TELEMETRY=0 / empty / "false" as NOT an opt-out (set-but-falsy = unset)', () => {
    for (const value of ["", "0", "false", "FALSE"]) {
      expect(
        resolveGating({
          env: { PRISMA_NEXT_DISABLE_TELEMETRY: value },
          config: { enableTelemetry: true },
          inCI: false,
        }).enabled,
      ).toBe(true);
    }
  });

  it("returns env-opt-out when DO_NOT_TRACK=1 overrides a true stored preference", () => {
    expect(
      resolveGating({
        env: { DO_NOT_TRACK: "1" },
        config: { enableTelemetry: true },
        inCI: false,
      }),
    ).toEqual({ enabled: false, reason: "env-opt-out" });
  });

  it('treats DO_NOT_TRACK=0 as NOT an opt-out (community convention pins the trigger to "=1")', () => {
    expect(
      resolveGating({
        env: { DO_NOT_TRACK: "0" },
        config: { enableTelemetry: true },
        inCI: false,
      }).enabled,
    ).toBe(true);
  });

  it("env override takes precedence over both stored false and stored true (returns the same env-opt-out reason)", () => {
    const result = resolveGating({
      env: { DO_NOT_TRACK: "1" },
      config: { enableTelemetry: false },
      inCI: false,
    });
    expect(result).toEqual({ enabled: false, reason: "env-opt-out" });
  });
});
