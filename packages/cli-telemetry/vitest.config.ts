import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // No test in this package forks a real sender: the fork-and-send
    // cases mock node:child_process, and the sender-integration case
    // spawns the sender itself against a local mock backend, never
    // through runTelemetry. This variable is the outer guard for any
    // code that does consult gating — the engine, when a consumer's
    // suite reaches production wiring — and is set here so it holds
    // under `pnpm --filter @repo/cli-telemetry test` and turbo alike.
    env: {
      PRISMA_NEXT_DISABLE_TELEMETRY: "1",
    },
  },
});
