/**
 * A prompting run in a real terminal must let the process exit once the
 * command has finished. Node's stdin keeps the event loop alive while it
 * is being read, and its async iterator cannot be returned while it is
 * awaiting a keystroke, so the bin's stdin adapter has to release it
 * itself. Only a pseudo-terminal shows this: a fake stdin has no handle
 * to keep the loop alive.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DRIVER = fileURLToPath(
  new URL("./fixtures/pty-driver.py", import.meta.url),
);
const BIN = fileURLToPath(
  new URL("./fixtures/prompting-bin.ts", import.meta.url),
);
const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

function python(): string | undefined {
  const probe = spawnSync("python3", ["-c", "import pty"], { stdio: "ignore" });
  return probe.status === 0 ? "python3" : undefined;
}

describe.skipIf(python() === undefined || process.platform === "win32")(
  "a prompting run under a pseudo-terminal",
  () => {
    it("exits on its own after the result is presented", () => {
      const report = JSON.parse(
        execFileSync("python3", [DRIVER, TSX, BIN], {
          encoding: "utf8",
          timeout: 60_000,
          env: { ...process.env, PRISMA_DISABLE_TELEMETRY: "1" },
        }),
      ) as {
        answered: boolean;
        settled: boolean;
        exitedOnItsOwn: boolean;
        exitCode: number | null;
        output: string;
      };

      expect(report.answered, report.output).toBe(true);
      expect(report.settled, report.output).toBe(true);
      expect(report.exitedOnItsOwn, report.output).toBe(true);
      expect(report.exitCode).toBe(0);
    });
  },
);
