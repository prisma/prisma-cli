import { dirname, resolve } from "node:path";
import { defineConfig } from "tsdown";

export default defineConfig([
  // The shipped CLI. Bundled (not unbundle) so the private
  // @repo/cli-telemetry workspace package lands inside this package's
  // own dist instead of being a published dependency; the sender entry
  // ships the forkable script at dist/sender.js. credentials-store is
  // bundled because its xdg-app-paths dependency publishes a broken Deno
  // conditional export. Other published deps stay external.
  {
    entry: {
      cli: "src/bin.ts",
      sender: "src/commands/telemetry/sender.ts",
    },
    format: ["esm"],
    clean: true,
    inputOptions: { moduleTypes: { ".md": "text" } },
    plugins: [
      {
        name: "markdown-text",
        resolveId(source, importer) {
          if (source.endsWith(`.md?raw`) && importer)
            return resolve(dirname(importer), source.slice(0, -4));
          return null;
        },
      },
    ],
    shims: true,
    fixedExtension: false,
    deps: {
      alwaysBundle: ["@prisma/credentials-store", "@repo/cli-telemetry"],
    },
    outDir: "dist",
  },
]);
