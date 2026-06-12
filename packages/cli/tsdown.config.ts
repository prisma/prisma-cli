import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    cli: "src/bin.ts",
    config: "src/config.ts",
  },
  format: ["esm"],
  clean: true,
  shims: true,
  unbundle: true,
  fixedExtension: false,
  outDir: "dist",
  // Declarations are needed for the public `@prisma/cli/config` entry.
  dts: true,
});
