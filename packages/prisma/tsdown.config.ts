import { defineConfig } from "tsdown";

export default defineConfig([
  // The same shell, published under the unscoped name with the `prisma`
  // bin. @prisma/cli's source is bundled in (as is the private telemetry
  // package) so this package has one implementation and no dependency on
  // an unpublishable workspace sibling. credentials-store is bundled too
  // because its xdg-app-paths dependency publishes a broken Deno conditional
  // export; the other published runtime deps stay external.
  {
    entry: {
      prisma: "src/bin.ts",
      sender: "src/sender.ts",
    },
    format: ["esm"],
    clean: true,
    shims: true,
    fixedExtension: false,
    deps: {
      alwaysBundle: [
        "@prisma/cli",
        "@prisma/credentials-store",
        "@repo/cli-telemetry",
      ],
    },
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
