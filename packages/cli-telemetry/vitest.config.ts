import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // No test in this package forks a real sender: the fork-and-send
    // cases mock node:child_process, and the sender-integration case
    // spawns the sender itself against a local mock backend, never
    // through runTelemetry. That, not this variable, is what holds —
    // nothing in this package consults gating any more, since the
    // engine owns it. Kept only against a future caller here that
    // reads it, and so it holds under `pnpm --filter
    // @repo/cli-telemetry test` and turbo alike.
    env: {
      PRISMA_NEXT_DISABLE_TELEMETRY: "1",
    },
  },
});
