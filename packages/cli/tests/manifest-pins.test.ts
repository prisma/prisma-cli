import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI_DIR = fileURLToPath(new URL("..", import.meta.url));

async function dependencies(dir: string): Promise<Record<string, string>> {
  const manifest = JSON.parse(
    await readFile(join(dir, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  return manifest.dependencies ?? {};
}

/**
 * The `prisma` wrapper bundles the same bin as `@prisma/cli`, so both
 * manifests must declare the SAME runtime dependencies at the SAME
 * versions. They are hand-carried in two files, and `npm install
 * prisma` resolves from the wrapper's copy — a divergence ships a bin
 * running against versions nothing was tested with.
 *
 * prisma@8.0.0-rc.8 is the incident this guards against: a product pin
 * was bumped only in packages/cli, the published wrapper resolved the
 * old @prisma/orm-toolchain, its old family keys made the mount table's
 * lookups undefined, and every invocation crashed. The conformance
 * sandbox masked it by hoisting the good version from @prisma/cli's
 * manifest, which a real install of `prisma` alone does not do.
 */
describe("the prisma wrapper's manifest", () => {
  it("declares exactly @prisma/cli's runtime dependencies", async () => {
    const cli = await dependencies(CLI_DIR);
    const wrapper = await dependencies(join(CLI_DIR, "..", "prisma"));
    expect(wrapper).toEqual(cli);
  });
});
