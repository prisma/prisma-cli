#!/usr/bin/env node

// Confirms the registry actually serves versions the workflow just
// published: `pnpm publish` reporting success is not the same as the
// version being resolvable. The registry is eventually consistent, so a
// miss is not a failure — never appearing is.
//
// Usage: node scripts/verify-published.mjs <spec>...

import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ATTEMPTS = 20;
const DELAY_MS = 15_000;
const NPM_NOT_FOUND_PATTERN = /\bE404\b/;

/**
 * Polls until every spec resolves, or reports the first that never does.
 *
 * @param {readonly string[]} specs
 * @param {{ check: (spec: string) => Promise<boolean>, sleep: (ms: number) => Promise<void>, attempts?: number }} io
 * @returns {Promise<{ ok: true } | { ok: false, spec: string }>}
 */
export async function waitForAll(specs, io) {
  const attempts = io.attempts ?? ATTEMPTS;
  for (const spec of specs) {
    let resolved = false;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // biome-ignore lint/performance/noAwaitInLoops: each attempt exists only because the previous one failed
      if (await io.check(spec)) {
        resolved = true;
        break;
      }
      if (attempt < attempts) await io.sleep(DELAY_MS);
    }
    if (!resolved) return { ok: false, spec };
  }
  return { ok: true };
}

/**
 * Whether a failed `npm view` means the version is absent (E404), as
 * opposed to npm itself failing — no binary, no network, no auth. Only
 * the absence is worth polling through; everything else must stop the
 * run and name the real cause.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isNotFoundError(error) {
  if (typeof error !== "object" || error === null) return false;
  const { stderr, stdout } =
    /** @type {{ stderr?: string, stdout?: string }} */ (error);
  return NPM_NOT_FOUND_PATTERN.test(`${stderr ?? ""}\n${stdout ?? ""}`);
}

async function resolvesOnRegistry(spec) {
  try {
    await execFileAsync("npm", ["view", spec, "version", "--prefer-online"]);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function main() {
  const specs = process.argv.slice(2);
  if (specs.length === 0) {
    console.error("Usage: node scripts/verify-published.mjs <spec>...");
    process.exit(1);
  }
  const result = await waitForAll(specs, {
    check: async (spec) => {
      const ok = await resolvesOnRegistry(spec);
      console.log(ok ? `${spec} resolves.` : `${spec} not resolvable yet...`);
      return ok;
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  if (!result.ok) {
    console.error(
      `::error::${result.spec} never became resolvable. It may still be propagating, but this run cannot say it shipped.`,
    );
    process.exit(1);
  }
  console.log(`All ${specs.length} published version(s) resolve.`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) await main();
