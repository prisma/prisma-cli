import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // No telemetry guard here, and none would do anything: the engine
    // reads process.env nowhere, and createTestCli seeds runtime.env
    // from opts.env ?? {}, so no variable set here reaches the gating
    // resolver. The suite is fail-closed by construction instead — an
    // env naming none of XDG_CONFIG_HOME, HOME, APPDATA or USERPROFILE
    // resolves no config path, so a test that says nothing about
    // telemetry reads no user config, mints nothing and reports nothing.
  },
});
