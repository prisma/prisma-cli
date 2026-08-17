import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/exports/index.ts",
    protocol: "src/exports/protocol.ts",
    testing: "src/exports/testing.ts",
  },
  format: ["esm"],
  // The ci-info vendor table is bundled INTO the output (see
  // src/ci.ts): the built engine may not load another package's
  // internal file at runtime. Everything else stays external.
  noExternal: ["ci-info/vendors.json"],
  dts: true,
  clean: true,
  fixedExtension: false,
  outDir: "dist",
});
