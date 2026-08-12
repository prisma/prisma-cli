/**
 * The mount's price, measured: the prisma bin imports composer's command
 * family statically, so the family module loads on every invocation —
 * but composer keeps its executors behind dynamic imports, so alchemy
 * and effect must not load with it, and alchemy's import-time exit hooks
 * must not end up in this process. A command with nothing to do with
 * composer is where that is worth proving, and it takes a process of its
 * own: a module loader hook in a fresh run records every module the run
 * evaluates, and the signal listeners are counted after it settles.
 *
 * The canary is what makes the empty result mean something: the same
 * probe, plus the one dynamic import a composer command would make,
 * loads the constellation the plain run reports none of.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const PROBE = fileURLToPath(
  new URL("./fixtures/v8-startup-probe.mjs", import.meta.url),
);

interface ProbeReport {
  readonly exitCode: number;
  readonly familyEvaluated: boolean;
  readonly constellation: readonly string[];
  readonly signalListeners: {
    readonly SIGINT: number;
    readonly SIGTERM: number;
  };
}

async function runProbe(scenario: "plain" | "canary"): Promise<ProbeReport> {
  const reportPath = join(
    mkdtempSync(join(tmpdir(), "v8-startup-probe-")),
    "report.json",
  );
  await new Promise<void>((resolve, reject) => {
    // Node 24 only, and that limit is this probe's rather than composer's:
    // tsx bypasses Node's module-syntax detection, so @alchemy.run/node-utils
    // (ESM in lib/*.js with no "type": "module") stops loading on 22 — and
    // the probe's own registerHooks load hook cannot run on 22.18 either.
    const child = spawn(
      process.execPath,
      ["--import", "tsx", PROBE, scenario, reportPath],
      {
        env: {
          ...process.env,
          NO_UPDATE_NOTIFIER: "1",
          PRISMA_NEXT_DISABLE_TELEMETRY: "1",
        },
        stdio: "ignore",
      },
    );
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`the startup probe exited ${code}`));
    });
  });
  return JSON.parse(readFileSync(reportPath, "utf8")) as ProbeReport;
}

describe("composer's family costs an unrelated command nothing", () => {
  test("a version run evaluates the family and none of alchemy or effect, and leaves no signal listener", async () => {
    const report = await runProbe("plain");

    expect(report.exitCode).toBe(0);
    expect(report.familyEvaluated).toBe(true);
    expect(report.constellation).toEqual([]);
    expect(report.signalListeners).toEqual({ SIGINT: 0, SIGTERM: 0 });
  }, 120_000);

  test("canary: the executor import a composer command makes does load the constellation", async () => {
    const report = await runProbe("canary");

    expect(report.constellation.length).toBeGreaterThan(0);
    expect(report.constellation.some((id) => id.startsWith("alchemy/"))).toBe(
      true,
    );
    expect(report.constellation.some((id) => id.startsWith("effect/"))).toBe(
      true,
    );
  }, 120_000);
});
