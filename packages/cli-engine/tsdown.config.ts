import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    protocol: "src/protocol.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  fixedExtension: false,
  outDir: "dist",
  deps: { neverBundle: ["@prisma/cli-engine/protocol"] },
});
