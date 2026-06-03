import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    cli: "src/bin.ts",
  },
  format: ["esm"],
  clean: true,
  shims: true,
  unbundle: true,
  fixedExtension: false,
  outDir: "dist",
  dts: false,
});
