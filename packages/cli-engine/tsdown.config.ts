import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    protocol: "src/protocol.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  fixedExtension: false,
  outDir: "dist",
});
