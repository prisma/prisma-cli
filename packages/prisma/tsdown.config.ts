import { defineConfig } from "tsdown";

export default defineConfig([
  // The same shell, published under the unscoped name with the `prisma`
  // bin. @prisma/cli's source is bundled in (as is the private telemetry
  // package) so this package has one implementation and no dependency on
  // an unpublishable workspace sibling; the published runtime deps stay
  // external and are declared here to match.
  {
    entry: {
      prisma: "src/bin.ts",
      sender: "src/sender.ts",
    },
    format: ["esm"],
    clean: true,
    shims: true,
    fixedExtension: false,
    noExternal: ["@prisma/cli", "@repo/cli-telemetry"],
    outDir: "dist",
  },
  // The `prisma/config` subpath for user prisma.config.ts files.
  // The engine stays external; only this entry ships types.
  {
    entry: {
      config: "src/config.ts",
    },
    format: ["esm"],
    dts: true,
    clean: false,
    fixedExtension: false,
    outDir: "dist",
  },
]);
