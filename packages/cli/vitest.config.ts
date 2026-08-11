import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Suite-wide telemetry guard, mirroring the reference repo's
    // repo-wide setting and cli-telemetry's own config: any test that
    // reaches production wiring reading the real `process.env` (the v8
    // bin's main(), resolveTelemetryHooks defaults) resolves gating
    // disabled instead of printing a first-run notice, minting into
    // the developer's real user config, or forking the sender toward
    // the real endpoint. Tests that exercise the enabled path pass an
    // explicit env object, which this does not touch.
    env: {
      PRISMA_NEXT_DISABLE_TELEMETRY: "1",
    },
  },
});
