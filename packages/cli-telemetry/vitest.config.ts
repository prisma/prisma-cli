import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // No telemetry guard here, and none is needed: no test in this
    // package forks a real sender. The fork-and-send cases mock
    // node:child_process, and the sender-integration case spawns the
    // sender itself against a local mock backend.
  },
});
