#!/usr/bin/env node

// Confirms that versions the publish workflow just pushed are actually
// served by the registry.
//
// `pnpm publish` printing a success line is not the same as the version
// being resolvable: on publish run 32104368661 it reported
// `✅ Published package prisma@8.0.0-rc.4` while `npm view` answered 404
// for several minutes, and nothing in the run could say whether the
// release had shipped.
//
// The registry is eventually consistent, so a miss is not a failure —
// this polls. Never appearing is a failure.
//
// Usage: node scripts/verify-published.mjs <spec>...

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ATTEMPTS = 20;
const DELAY_MS = 15_000;

/**
 * Polls until every spec resolves, or reports the first that never does.
 * The registry lookup and the clock are injected so the tests need
 * neither.
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
      // biome-ignore lint/performance/noAwaitInLoops: polling is sequential by nature — each attempt exists only because the previous one failed
      if (await io.check(spec)) {
        resolved = true;
        break;
      }
      await io.sleep(DELAY_MS);
    }
    if (!resolved) return { ok: false, spec };
  }
  return { ok: true };
}

async function resolvesOnRegistry(spec) {
  try {
    await execFileAsync("npm", ["view", spec, "version", "--prefer-online"]);
    return true;
  } catch {
    return false;
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
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) await main();
