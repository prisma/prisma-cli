#!/usr/bin/env node

import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function stageCliPublishPackage(options = {}) {
  const sourceDir =
    options.sourceDir ?? path.join(getRepoRoot(), "packages/cli");
  const outputDir =
    options.outputDir ?? path.join(getRepoRoot(), ".publish/cli");
  const publishVersion = options.publishVersion;

  await ensureBuildArtifacts(sourceDir);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  await cp(path.join(sourceDir, "dist"), path.join(outputDir, "dist"), {
    recursive: true,
  });
  await cp(
    path.join(sourceDir, "README.md"),
    path.join(outputDir, "README.md"),
  );
  await cp(
    path.join(getRepoRoot(), "LICENSE"),
    path.join(outputDir, "LICENSE"),
  );

  const sourceManifest = JSON.parse(
    await readFile(path.join(sourceDir, "package.json"), "utf8"),
  );

  const publishManifest = {
    name: sourceManifest.name,
    version: publishVersion ?? sourceManifest.version,
    description: sourceManifest.description,
    type: sourceManifest.type,
    bin: {
      "prisma-cli": "./dist/cli.js",
    },
    files: ["dist", "README.md", "LICENSE"],
    publishConfig: {
      access: "public",
    },
    engines: sourceManifest.engines,
    keywords: sourceManifest.keywords,
    repository: sourceManifest.repository,
    homepage: sourceManifest.homepage,
    bugs: sourceManifest.bugs,
    license: sourceManifest.license,
    dependencies: sourceManifest.dependencies,
  };

  await writeFile(
    path.join(outputDir, "package.json"),
    `${JSON.stringify(removeUndefinedFields(publishManifest), null, 2)}\n`,
    "utf8",
  );

  return outputDir;
}

function getRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function ensureBuildArtifacts(sourceDir) {
  const builtCliPath = path.join(sourceDir, "dist/cli.js");

  try {
    await access(builtCliPath);
  } catch {
    throw new Error(
      `Missing built CLI artifact at ${builtCliPath}. Run "pnpm --filter @prisma/cli build" first.`,
    );
  }
}

function removeUndefinedFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

async function main() {
  const { outputDir, publishVersion } = parseCliArgs(process.argv.slice(2));
  const stagedPath = await stageCliPublishPackage({
    ...(outputDir ? { outputDir: path.resolve(outputDir) } : {}),
    ...(publishVersion ? { publishVersion } : {}),
  });
  process.stdout.write(`${stagedPath}\n`);
}

function parseCliArgs(args) {
  let outputDir;
  let publishVersion = process.env.CLI_PUBLISH_VERSION;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--version") {
      const nextArg = args[index + 1];
      if (!nextArg || nextArg.startsWith("--")) {
        throw new Error("--version requires a value.");
      }
      publishVersion = nextArg;
      index += 1;
      continue;
    }

    if (arg?.startsWith("--version=")) {
      publishVersion = arg.slice("--version=".length);
      continue;
    }

    if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (outputDir) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    outputDir = arg;
  }

  if (publishVersion !== undefined && publishVersion.trim() === "") {
    throw new Error("Publish version cannot be empty.");
  }

  return { outputDir, publishVersion };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
