import { describe, expect, it } from "vitest";
import {
  resolveTelemetryEndpoint,
  TELEMETRY_BACKEND_URL,
  TELEMETRY_ENDPOINT_PATH,
} from "../src/telemetry/endpoint";

const PRODUCTION = `${TELEMETRY_BACKEND_URL}${TELEMETRY_ENDPOINT_PATH}`;

describe("resolveTelemetryEndpoint", () => {
  it("targets the pinned backend and its events path when nothing overrides it", () => {
    expect(resolveTelemetryEndpoint({})).toBe(PRODUCTION);
  });

  it("honours PRISMA_TELEMETRY_ENDPOINT", () => {
    expect(
      resolveTelemetryEndpoint({
        PRISMA_TELEMETRY_ENDPOINT: "http://127.0.0.1:54321",
      }),
    ).toBe(`http://127.0.0.1:54321${TELEMETRY_ENDPOINT_PATH}`);
  });

  it("ignores the retired PRISMA_NEXT_TELEMETRY_ENDPOINT", () => {
    expect(
      resolveTelemetryEndpoint({
        PRISMA_NEXT_TELEMETRY_ENDPOINT: "http://127.0.0.1:54321",
      }),
    ).toBe(PRODUCTION);
  });

  it("treats an empty override as unset", () => {
    expect(resolveTelemetryEndpoint({ PRISMA_TELEMETRY_ENDPOINT: "" })).toBe(
      PRODUCTION,
    );
  });

  it("resolves the events path against an override that carries a trailing slash", () => {
    expect(
      resolveTelemetryEndpoint({
        PRISMA_TELEMETRY_ENDPOINT: "http://127.0.0.1:54321/",
      }),
    ).toBe(`http://127.0.0.1:54321${TELEMETRY_ENDPOINT_PATH}`);
  });

  it("drops a path on the override — the events path is root-absolute", () => {
    // Worth pinning rather than leaving implicit: an override written
    // with a prefix silently loses it, so a mis-specified endpoint posts
    // to the host's root instead of where its author meant.
    expect(
      resolveTelemetryEndpoint({
        PRISMA_TELEMETRY_ENDPOINT: "http://127.0.0.1:54321/base",
      }),
    ).toBe(`http://127.0.0.1:54321${TELEMETRY_ENDPOINT_PATH}`);
  });

  it("falls back to the pinned backend, without throwing, when the override is malformed", () => {
    for (const malformed of ["invalid-url", "://nope", " ", "127.0.0.1:1234"]) {
      expect(
        resolveTelemetryEndpoint({
          PRISMA_TELEMETRY_ENDPOINT: malformed,
        }),
        malformed,
      ).toBe(PRODUCTION);
    }
  });
});
