#!/usr/bin/env node

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliPath = path.join(repoRoot, "packages/cli/dist/cli.js");
const fixturePath = path.join(repoRoot, "examples/next-smoke");

await runFixtureInstall();
const result = await runCliBuild();
const artifactDir = result.result?.directory;

if (!artifactDir || typeof artifactDir !== "string") {
  throw new Error("CLI build output did not include result.directory");
}

try {
  const constantsPath = path.join(
    artifactDir,
    "node_modules/next/dist/shared/lib/constants.js",
  );
  const requireFromNext = createRequire(constantsPath);
  const resolved = requireFromNext.resolve(
    "@swc/helpers/_/_interop_require_default",
  );

  process.stdout.write(`Next.js artifact smoke passed: ${resolved}\n`);
} finally {
  await rm(path.dirname(artifactDir), { recursive: true, force: true });
}

async function runFixtureInstall() {
  const exit = await runCommand("pnpm", ["install", "--frozen-lockfile"], {
    cwd: fixturePath,
    env: process.env,
  });

  if (exit !== 0) {
    throw new Error(
      `Next.js smoke fixture install failed with exit code ${exit}`,
    );
  }
}

async function runCliBuild() {
  const child = spawn(
    process.execPath,
    [cliPath, "app", "build", "--build-type", "nextjs", "--json"],
    {
      cwd: fixturePath,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        INIT_CWD: fixturePath,
      },
    },
  );

  const [stdout, stderr, exit] = await Promise.all([
    collect(child.stdout),
    collect(child.stderr),
    waitForExit(child),
  ]);

  if (exit !== 0) {
    throw new Error(
      `CLI Next.js build smoke failed with exit code ${exit}\n\nstderr:\n${stderr}\n\nstdout:\n${stdout}`,
    );
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `CLI Next.js build smoke returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\n\nstdout:\n${stdout}`,
    );
  }
}

async function runCommand(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: "inherit",
    env: options.env,
  });

  return waitForExit(child);
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => {
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}
