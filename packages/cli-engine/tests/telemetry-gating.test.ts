/**
 * The whole gating precedence table: CI × both environment opt-outs
 * (including the set-but-falsy spellings that must NOT disable) ×
 * stored true / false / absent. Each block asserts one constant
 * decision, so the expectation is spelled out rather than re-derived
 * from the resolver's own rules.
 */
import { describe, expect, it } from "vitest";
import { resolveGating } from "../src/telemetry/gating";
import type { UserConfig } from "../src/telemetry/user-config";

/** Values of `PRISMA_DISABLE_TELEMETRY` that opt out. */
const DISABLING_PRISMA_VAR = ["1", "true", "yes", "on", "anything-truthy"];
/** Set-but-falsy spellings, trimmed and case-insensitive: not an opt-out. */
const KEPT_PRISMA_VAR = [undefined, "", "0", "false", "FALSE", "  false  "];
/** `DO_NOT_TRACK` opts out on exactly `1`, per the community convention. */
const DISABLING_DO_NOT_TRACK = ["1"];
const KEPT_DO_NOT_TRACK = [undefined, "", "0", "false", "true"];

const ALL_PRISMA_VAR = [...DISABLING_PRISMA_VAR, ...KEPT_PRISMA_VAR];
const ALL_DO_NOT_TRACK = [...DISABLING_DO_NOT_TRACK, ...KEPT_DO_NOT_TRACK];

const STORED_ABSENT = { label: "absent", config: {} as UserConfig };
const STORED_TRUE = {
  label: "true",
  config: { enableTelemetry: true } as UserConfig,
};
const STORED_FALSE = {
  label: "false",
  config: { enableTelemetry: false } as UserConfig,
};
const ALL_STORED = [STORED_ABSENT, STORED_TRUE, STORED_FALSE];

interface Combination {
  readonly label: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly config: UserConfig;
}

function show(value: string | undefined): string {
  return value === undefined ? "<unset>" : JSON.stringify(value);
}

function combinations(
  prismaSpellings: readonly (string | undefined)[],
  doNotTrackSpellings: readonly (string | undefined)[],
  stored: readonly (typeof STORED_ABSENT)[],
): readonly Combination[] {
  return prismaSpellings.flatMap((prisma) =>
    doNotTrackSpellings.flatMap((doNotTrack) =>
      stored.map((entry) => ({
        label: `PRISMA_DISABLE_TELEMETRY=${show(prisma)} DO_NOT_TRACK=${show(doNotTrack)} stored=${entry.label}`,
        env: {
          PRISMA_DISABLE_TELEMETRY: prisma,
          DO_NOT_TRACK: doNotTrack,
        },
        config: entry.config,
      })),
    ),
  );
}

describe("resolveGating", () => {
  it("CI disables ahead of every other signal", () => {
    for (const { label, env, config } of combinations(
      ALL_PRISMA_VAR,
      ALL_DO_NOT_TRACK,
      ALL_STORED,
    )) {
      expect(resolveGating({ env, config, inCI: true }), label).toEqual({
        enabled: false,
        reason: "ci",
      });
    }
  });

  it("a truthy PRISMA_DISABLE_TELEMETRY disables whatever is stored", () => {
    for (const { label, env, config } of combinations(
      DISABLING_PRISMA_VAR,
      ALL_DO_NOT_TRACK,
      ALL_STORED,
    )) {
      expect(resolveGating({ env, config, inCI: false }), label).toEqual({
        enabled: false,
        reason: "env-opt-out",
      });
    }
  });

  it("DO_NOT_TRACK=1 disables whatever is stored", () => {
    for (const { label, env, config } of combinations(
      KEPT_PRISMA_VAR,
      DISABLING_DO_NOT_TRACK,
      ALL_STORED,
    )) {
      expect(resolveGating({ env, config, inCI: false }), label).toEqual({
        enabled: false,
        reason: "env-opt-out",
      });
    }
  });

  it("a stored false disables when no CI or environment opt-out applies", () => {
    for (const { label, env, config } of combinations(
      KEPT_PRISMA_VAR,
      KEPT_DO_NOT_TRACK,
      [STORED_FALSE],
    )) {
      expect(resolveGating({ env, config, inCI: false }), label).toEqual({
        enabled: false,
        reason: "stored-opt-out",
      });
    }
  });

  it("a stored true enables when no CI or environment opt-out applies", () => {
    for (const { label, env, config } of combinations(
      KEPT_PRISMA_VAR,
      KEPT_DO_NOT_TRACK,
      [STORED_TRUE],
    )) {
      expect(resolveGating({ env, config, inCI: false }), label).toEqual({
        enabled: true,
        reason: "stored-opt-in",
      });
    }
  });

  it("an absent stored preference enables — the opt-out default", () => {
    for (const { label, env, config } of combinations(
      KEPT_PRISMA_VAR,
      KEPT_DO_NOT_TRACK,
      [STORED_ABSENT],
    )) {
      expect(resolveGating({ env, config, inCI: false }), label).toEqual({
        enabled: true,
        reason: "default-on",
      });
    }
  });

  it("ignores the retired PRISMA_NEXT_DISABLE_TELEMETRY", () => {
    expect(
      resolveGating({
        env: { PRISMA_NEXT_DISABLE_TELEMETRY: "1" },
        config: {},
        inCI: false,
      }),
    ).toEqual({ enabled: true, reason: "default-on" });
  });

  it("ignores unknown stored fields and unrelated environment variables", () => {
    expect(
      resolveGating({
        env: { PRISMA_TELEMETRY: "off", CI: "true" },
        config: { someFutureField: "opaque" },
        inCI: false,
      }),
    ).toEqual({ enabled: true, reason: "default-on" });
  });
});
