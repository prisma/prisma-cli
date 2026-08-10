/**
 * Bin-side telemetry reporting: resolve the gating decision up front
 * (cheap, all in-memory plus one tiny user-config read); only when
 * enabled, attach an `onSettled` hook that spawns the detached sender
 * via `runTelemetry` (fork + IPC send + disconnect + unref, every
 * failure swallowed). When the decision comes back disabled, no hook
 * is attached at all.
 *
 * Timing (operator-ratified): the first-run disclosure prints at
 * gating time — pre-run, before any command output — while the event
 * itself is emitted at settlement (`onSettled`). The ORM CLI emitted
 * from a commander `preAction` hook; the consequence of the onSettled
 * design is that a run that crashes, is SIGKILLed, or exits through
 * `process.exit` before settlement emits no telemetry. Recorded in the
 * S2a parity divergence list.
 */
import { fileURLToPath } from "node:url";
import type { CliRunHooks, HostProcess } from "@prisma/cli-engine";
import {
  ensureInstallationId,
  type RunTelemetryInputs,
  readUserConfig,
  resolveGating,
  runTelemetry,
  type TelemetryRunOutcome,
  type UserConfig,
  userConfigPath,
} from "@repo/cli-telemetry";
import { CLI_DOCS_URL, CLI_NAME } from "../../cli-name";
import { getCliVersion } from "../../lib/version";
import { isCI } from "./is-ci";

/**
 * Path to the compiled sender entry. In the workspace (dev runs and
 * the monorepo dist) the package specifier resolves to
 * `packages/cli-telemetry/dist/sender.js`; in the published cli the
 * telemetry package is bundled away, so the fallback resolves the
 * copy tsdown emits next to the v8 entry (`dist/v8/sender.js`).
 */
function resolveSenderPath(): string {
  try {
    return fileURLToPath(import.meta.resolve("@repo/cli-telemetry/sender"));
  } catch {
    return fileURLToPath(new URL("./sender.js", import.meta.url));
  }
}

/**
 * The one-time first-run disclosure. The resolved absolute path to
 * the user-level config file is substituted in so the user can see
 * exactly which file to edit. `telemetry disable` is named as the
 * primary, friendliest opt-out, alongside the env vars and the
 * config edit.
 */
function firstRunNotice(configPath: string): string {
  return [
    "Prisma collects anonymous CLI usage data, enabled by default.",
    `What's collected and why: ${CLI_DOCS_URL}.`,
    `Opt out: run "${CLI_NAME} telemetry disable", set DO_NOT_TRACK=1 or`,
    `PRISMA_NEXT_DISABLE_TELEMETRY=1, or set "enableTelemetry": false in ${configPath}.`,
  ].join(" ");
}

export interface TelemetryReportingOptions {
  /** CI decision override; defaults to `isCI()` (ci-info). */
  readonly inCI?: boolean;
  /** Spawn seam for tests; defaults to `runTelemetry`. */
  readonly fire?: (inputs: RunTelemetryInputs) => TelemetryRunOutcome;
  /** Sender path override; defaults to {@link resolveSenderPath}. */
  readonly senderPath?: string;
}

/**
 * Resolve the telemetry decision for this process and return the hook
 * to attach — or `undefined` when telemetry is off (CI, env opt-out,
 * or stored opt-out), so a disabled run carries no hook at all. On the
 * enabled path with no stored installation id yet, the first-run
 * disclosure prints to stderr HERE — before the command runs, so the
 * user learns about collection before any output.
 *
 * The attached hook fires after settlement with the engine's
 * value-free snapshot. The `telemetry` command and its subcommands are
 * exempt — `telemetry disable` must not send a usage event before
 * disabling, and `telemetry status` must not mint an id while merely
 * reporting state. On the first enabled fire the hook mints the shared
 * installation id (best-effort; a failed mint skips the event).
 */
export function resolveTelemetryHooks(
  proc: Pick<HostProcess, "env" | "cwd" | "stderr">,
  options?: TelemetryReportingOptions,
): CliRunHooks | undefined {
  const inCI = options?.inCI ?? isCI();
  const userConfig = readUserConfig();
  if (!resolveGating({ env: proc.env, config: userConfig, inCI }).enabled) {
    return undefined;
  }
  const storedId = userConfig.installationId;
  const hasStoredId = typeof storedId === "string" && storedId.length > 0;
  if (!hasStoredId) {
    try {
      proc.stderr.write(`${firstRunNotice(userConfigPath())}\n`);
    } catch {}
  }
  const fire = options?.fire ?? runTelemetry;
  return {
    onSettled: (summary) => {
      try {
        if (summary.snapshot.commandPath[0] === "telemetry") {
          return;
        }
        let config: UserConfig = userConfig;
        if (!hasStoredId) {
          // Best-effort mint of the persistent id, without touching
          // `enableTelemetry` — the opt-out default stays intact and no
          // unasked-for consent is recorded. On failure the notice may
          // reprint next run, and `runTelemetry` no-ops on the missing
          // id.
          try {
            config = { ...config, installationId: ensureInstallationId() };
          } catch {}
        }
        fire({
          command: summary.snapshot,
          version: getCliVersion(),
          projectRoot: proc.cwd(),
          senderPath: options?.senderPath ?? resolveSenderPath(),
          isCI: inCI,
          env: proc.env,
          userConfig: config,
        });
      } catch {
        // Telemetry must never break a command.
      }
    },
  };
}
