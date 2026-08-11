import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Suite-wide telemetry guard, the same one packages/cli sets. The
    // engine reports only from an env a test hands it, and the store
    // resolves nothing from an env that names no config directory, so
    // nothing here should reach a real user config or a real sender —
    // this makes that structural rather than a property of every test
    // remembering to seed its own env.
    env: {
      PRISMA_NEXT_DISABLE_TELEMETRY: "1",
    },
  },
});
