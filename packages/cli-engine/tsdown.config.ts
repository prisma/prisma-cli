import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/exports/index.ts",
    protocol: "src/exports/protocol.ts",
    testing: "src/exports/testing.ts",
  },
  format: ["esm"],
  // The vendor table is embedded; see src/ci.ts.
  noExternal: ["ci-info/vendors.json"],
  dts: true,
  clean: true,
  fixedExtension: false,
  outDir: "dist",
});
