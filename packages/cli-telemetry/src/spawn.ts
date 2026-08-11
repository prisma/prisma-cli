import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ParentToSenderPayload } from "./payload";

export interface RunTelemetryInputs {
  /**
   * The composed payload, handed over verbatim. The engine resolved
   * gating, read the user config, minted the installation id and
   * composed this before calling; nothing here re-decides any of it.
   */
  readonly payload: ParentToSenderPayload;
  /**
   * Path to the sender entry compiled into this package's `dist/`.
   * Resolved by the caller because the compiled sender lives at
   * `<package>/dist/sender.js` and only the consumer knows its own
   * `import.meta.url`.
   */
  readonly senderPath: string;
}

/**
 * Returned so debug-mode logging can inspect the outcome without
 * scraping stderr.
 */
export type TelemetryRunOutcome =
  | { readonly spawned: true }
  | { readonly spawned: false; readonly reason: "fork-failed" };

/**
 * Fork the detached sender and hand it one payload over IPC. Returns
 * synchronously — the child runs in the background and never blocks the
 * parent. Every failure mode is swallowed; the parent's stdout/stderr is
 * untouched in normal operation, the only escape valve being
 * `PRISMA_NEXT_DEBUG=1` which routes diagnostics to stderr.
 */
export function runTelemetry(inputs: RunTelemetryInputs): TelemetryRunOutcome {
  try {
    const child = fork(inputs.senderPath, [], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore", "ipc"],
    });
    // fork() reports failures that surface after the synchronous call
    // (missing sender path, spawn EMFILE, ...) as an async "error"
    // event. An unhandled "error" would crash the parent and, even
    // when the parent is already exiting, flip its exit code — so it
    // is swallowed unconditionally.
    child.on("error", () => {});
    child.send(inputs.payload, (err) => {
      if (err !== null && process.env["PRISMA_NEXT_DEBUG"] === "1") {
        process.stderr.write(
          `[cli-telemetry] parent send error: ${String(err)}\n`,
        );
      }
    });
    child.disconnect();
    child.unref();
    return { spawned: true };
  } catch (err) {
    if (process.env["PRISMA_NEXT_DEBUG"] === "1") {
      process.stderr.write(
        `[cli-telemetry] parent fork failed: ${String(err)}\n`,
      );
    }
    return { spawned: false, reason: "fork-failed" };
  }
}

/**
 * Resolve the path to the compiled sender entry relative to a consumer
 * that has captured its own `import.meta.url`. The `tsdown`-emitted
 * entry sits at `<dist>/sender.js` next to the consumer's own entry;
 * the consumer asks `senderModuleUrl()` and forwards the result to
 * `runTelemetry({ senderPath })`.
 */
export function senderModuleUrl(importMetaUrl: string): string {
  return fileURLToPath(new URL("./sender.js", importMetaUrl));
}
