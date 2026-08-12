import { defineConfig } from "tsdown";

export default defineConfig([
  // The shipped CLI. Bundled (not unbundle) so the private
  // @repo/cli-telemetry workspace package lands inside this package's
  // own dist instead of being a published dependency; the sender entry
  // ships the forkable script at dist/sender.js. Published deps
  // (engine, @vercel/detect-agent, …) stay external.
  {
    entry: {
      cli: "src/bin.ts",
      sender: "src/commands/telemetry/sender.ts",
    },
    format: ["esm"],
    clean: true,
    shims: true,
    fixedExtension: false,
    noExternal: ["@repo/cli-telemetry"],
    outDir: "dist",
  },
]);
