import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Suite-wide telemetry guard, mirroring the reference repo's
    // repo-wide setting: any test that reaches production wiring
    // reading the real `process.env` (the v8 bin's main(), which hands
    // it to the engine as runtime.env) resolves gating disabled
    // instead of printing a first-run notice, minting into the
    // developer's real user config, or forking the sender toward the
    // real endpoint. Pinned by v8-telemetry-reporting.test.ts. Tests
    // that exercise the enabled path pass an explicit env object,
    // which this does not touch.
    env: {
      PRISMA_DISABLE_TELEMETRY: "1",
    },
  },
});
