import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/exports/index.ts",
    protocol: "src/exports/protocol.ts",
    testing: "src/exports/testing.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  fixedExtension: false,
  outDir: "dist",
});
