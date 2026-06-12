import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

// The script is exercised as a subprocess, exactly as CI invokes it. Tests
// never import it: out-of-root shebang scripts break the Windows transform.
const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL("../../../scripts/prepare-cli-publish.mjs", import.meta.url),
);

async function stagePackage(options: {
  sourceDir: string;
  outputDir: string;
  publishVersion?: string;
}): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    options.outputDir,
    "--source-dir",
    options.sourceDir,
    ...(options.publishVersion ? ["--version", options.publishVersion] : []),
  ]);
  return stdout.trim();
}

function createTempCwd(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "prisma-cli-"));
}

describe("prepare cli publish", () => {
  it("stages a public package manifest for @prisma/cli", async () => {
    const cwd = await createTempCwd();
    const sourceDir = path.join(cwd, "source");
    const outputDir = path.join(cwd, "staged");

    await mkdir(path.join(sourceDir, "dist"), { recursive: true });
    await writeFile(path.join(cwd, "LICENSE"), "Apache-2.0\n", "utf8");
    await writeFile(
      path.join(sourceDir, "package.json"),
      JSON.stringify(
        {
          name: "@prisma/cli",
          private: true,
          version: "3.0.0-development",
          description:
            "Command-line interface for the Prisma Developer Platform.",
          type: "module",
          exports: {
            "./package.json": "./package.json",
          },
          engines: {
            node: ">=20",
          },
          keywords: ["prisma", "cli"],
          repository: {
            type: "git",
            url: "https://github.com/prisma/prisma-cli.git",
            directory: "packages/cli",
          },
          homepage: "https://github.com/prisma/prisma-cli#readme",
          bugs: {
            url: "https://github.com/prisma/prisma-cli/issues",
          },
          license: "Apache-2.0",
          dependencies: {
            commander: "^12.1.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "README.md"),
      "# Test package\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "dist/cli.js"),
      "#!/usr/bin/env node\nconsole.log('ok')\n",
      "utf8",
    );

    const stagedPath = await stagePackage({ sourceDir, outputDir });
    const manifest = JSON.parse(
      await readFile(path.join(stagedPath, "package.json"), "utf8"),
    );

    expect(stagedPath).toBe(outputDir);
    expect(manifest).toEqual({
      name: "@prisma/cli",
      version: "3.0.0-development",
      description: "Command-line interface for the Prisma Developer Platform.",
      type: "module",
      bin: {
        "prisma-cli": "./dist/cli.js",
      },
      exports: {
        "./package.json": "./package.json",
      },
      files: ["dist", "README.md", "LICENSE"],
      publishConfig: {
        access: "public",
      },
      engines: {
        node: ">=20",
      },
      keywords: ["prisma", "cli"],
      repository: {
        type: "git",
        url: "https://github.com/prisma/prisma-cli.git",
        directory: "packages/cli",
      },
      homepage: "https://github.com/prisma/prisma-cli#readme",
      bugs: {
        url: "https://github.com/prisma/prisma-cli/issues",
      },
      license: "Apache-2.0",
      dependencies: {
        commander: "^12.1.0",
      },
    });
    expect(manifest).not.toHaveProperty("private");
  });

  it("uses an injected publish version when staging the package", async () => {
    const cwd = await createTempCwd();
    const sourceDir = path.join(cwd, "source");
    const outputDir = path.join(cwd, "staged");

    await mkdir(path.join(sourceDir, "dist"), { recursive: true });
    await writeFile(path.join(cwd, "LICENSE"), "Apache-2.0\n", "utf8");
    await writeFile(
      path.join(sourceDir, "package.json"),
      JSON.stringify(
        {
          name: "@prisma/cli",
          version: "3.0.0-development",
          description:
            "Command-line interface for the Prisma Developer Platform.",
          type: "module",
          dependencies: {},
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "README.md"),
      "# Test package\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "dist/cli.js"),
      "#!/usr/bin/env node\nconsole.log('ok')\n",
      "utf8",
    );

    const stagedPath = await stagePackage({
      sourceDir,
      outputDir,
      publishVersion: "3.0.0-beta.0",
    });
    const manifest = JSON.parse(
      await readFile(path.join(stagedPath, "package.json"), "utf8"),
    );

    expect(manifest.version).toBe("3.0.0-beta.0");
  });

  it("stages only npm package files", async () => {
    const cwd = await createTempCwd();
    const sourceDir = path.join(cwd, "source");
    const outputDir = path.join(cwd, "staged");

    await mkdir(path.join(sourceDir, "dist"), { recursive: true });
    await mkdir(path.join(sourceDir, "src"), { recursive: true });
    await mkdir(path.join(sourceDir, "tests"), { recursive: true });
    await mkdir(path.join(sourceDir, "fixtures"), { recursive: true });
    await writeFile(path.join(cwd, "LICENSE"), "Apache-2.0\n", "utf8");
    await writeFile(
      path.join(sourceDir, "package.json"),
      JSON.stringify(
        {
          name: "@prisma/cli",
          version: "3.0.0-development",
          description:
            "Command-line interface for the Prisma Developer Platform.",
          type: "module",
          dependencies: {},
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "README.md"),
      "# Test package\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "dist/cli.js"),
      "#!/usr/bin/env node\nconsole.log('ok')\n",
      "utf8",
    );
    await writeFile(path.join(sourceDir, "src/cli.ts"), "export {}\n", "utf8");
    await writeFile(
      path.join(sourceDir, "tests/cli.test.ts"),
      "export {}\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "fixtures/mock-api.json"),
      "{}\n",
      "utf8",
    );

    const stagedPath = await stagePackage({ sourceDir, outputDir });
    const topLevelFiles = await readdir(stagedPath);
    const distFiles = await readdir(path.join(stagedPath, "dist"));

    expect(topLevelFiles.sort()).toEqual([
      "LICENSE",
      "README.md",
      "dist",
      "package.json",
    ]);
    expect(distFiles).toEqual(["cli.js"]);
  });
});
