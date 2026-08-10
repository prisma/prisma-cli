import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: {
      cli: "src/bin.ts",
    },
    format: ["esm"],
    clean: true,
    shims: true,
    unbundle: true,
    fixedExtension: false,
    outDir: "dist",
  },
  // The v8 shell. Bundled (not unbundle) so the private
  // @repo/cli-telemetry workspace package lands inside this package's
  // own dist instead of being a published dependency; the sender entry
  // ships the forkable script at dist/v8/sender.js. Published deps
  // (engine, ci-info, @vercel/detect-agent, …) stay external.
  {
    entry: {
      "v8/cli": "src/v8/bin.ts",
      "v8/sender": "src/v8/telemetry/sender.ts",
    },
    format: ["esm"],
    clean: false,
    shims: true,
    fixedExtension: false,
    noExternal: ["@repo/cli-telemetry"],
    outDir: "dist",
  },
]);
