import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.ts"],
    // Real network calls and real resource lifecycles.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // One file at a time: these tests create and delete real resources
    // in one shared workspace, and parallel files would race over them.
    fileParallelism: false,
  },
});
