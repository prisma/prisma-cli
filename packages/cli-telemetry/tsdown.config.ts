import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/exports/index.ts",
    sender: "src/sender.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  fixedExtension: false,
  outDir: "dist",
});
