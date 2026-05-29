#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 10_000;
const TRANSIENT_WORKFLOW_RECORD_ERROR =
  /Check failed \(404\):.*There is no workflow defined for/s;

export function isTransientPkgPrNewWorkflowError(output) {
  return TRANSIENT_WORKFLOW_RECORD_ERROR.test(output);
}

export async function publishCliPrPreview(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const maxAttempts =
    options.maxAttempts ?? readPositiveIntEnv("PKG_PR_NEW_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS);
  const retryDelayMs =
    options.retryDelayMs ?? readPositiveIntEnv("PKG_PR_NEW_RETRY_DELAY_MS", DEFAULT_RETRY_DELAY_MS);
  const packageDir = options.packageDir ?? ".publish/cli";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runPkgPrNewPublish(cwd, packageDir);
    if (result.exitCode === 0) {
      return;
    }

    if (
      attempt < maxAttempts &&
      isTransientPkgPrNewWorkflowError(result.output)
    ) {
      process.stderr.write(
        `pkg.pr.new has not registered this workflow run yet; retrying in ${retryDelayMs / 1000}s (${attempt + 1}/${maxAttempts}).\n`,
      );
      await sleep(retryDelayMs);
      continue;
    }

    process.exitCode = result.exitCode ?? 1;
    return;
  }
}

function runPkgPrNewPublish(cwd, packageDir) {
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "pkg-pr-new",
        "publish",
        "--bin",
        "--comment=update",
        packageDir,
      ],
      {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output += String(chunk);
    });

    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      output += message;
      resolve({ exitCode: 1, output });
    });

    child.on("close", (exitCode) => {
      resolve({ exitCode, output });
    });
  });
}

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const packageDir = process.argv[2] ?? ".publish/cli";
  await publishCliPrPreview({ packageDir });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    const message =
      error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
