import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Harness short-circuit: the probe test in
    // `tests/no-spawn-in-tests.test.ts` verifies test runs never fork
    // the detached sender. Set here so it holds under
    // `pnpm --filter @repo/cli-telemetry test` and under turbo alike.
    env: {
      PRISMA_NEXT_DISABLE_TELEMETRY: "1",
    },
  },
});
