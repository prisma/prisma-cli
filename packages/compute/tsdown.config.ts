import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  clean: true,
  unbundle: true,
  fixedExtension: false,
  outDir: "dist",
  dts: true,
});
