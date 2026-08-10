/**
 * Bin-side telemetry wiring, sequenced like the ORM CLI's preAction
 * wiring: resolve the CI/env/consent decision up front (cheap, all
 * in-memory plus one tiny user-config read); only when enabled,
 * attach an `onSettled` hook that spawns the detached sender via
 * `runTelemetry` (fork + IPC send + disconnect + unref, every failure
 * swallowed). When the decision comes back disabled, no hook is
 * attached at all.
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
    "What's collected and why: https://prisma-next.dev/docs/cli/telemetry.",
    'Opt out: run "prisma telemetry disable", set DO_NOT_TRACK=1 or',
    `PRISMA_NEXT_DISABLE_TELEMETRY=1, or set "enableTelemetry": false in ${configPath}.`,
  ].join(" ");
}

/**
 * Best-effort first-run disclosure + installationId mint. Runs only on
 * the enabled path. Prints the notice to stderr (never stdout) and
 * mints a persistent id without touching `enableTelemetry`, so the
 * opt-out default stays intact and no unasked-for consent is recorded.
 *
 * Every step is wrapped so an un-writable config dir (or any other
 * failure) never throws and never blocks the command. On mint failure
 * it returns `undefined`: the notice may reprint next run, and
 * `runTelemetry` no-ops on the missing id.
 */
function discloseAndMintOnFirstRun(
  stderr: HostProcess["stderr"],
): string | undefined {
  try {
    stderr.write(`${firstRunNotice(userConfigPath())}\n`);
  } catch {}
  try {
    return ensureInstallationId();
  } catch {}
  return undefined;
}

export interface TelemetryWiringOptions {
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
 * or stored opt-out), so a disabled run carries no hook at all.
 *
 * The attached hook fires after settlement with the engine's
 * value-free snapshot. The `telemetry` command and its subcommands are
 * exempt — `telemetry disable` must not send a usage event before
 * disabling, and `telemetry status` must not mint an id while merely
 * reporting state. On the enabled path with no stored id yet, the hook
 * performs the first-run disclosure and mints the shared installation
 * id before spawning the sender.
 */
export function resolveTelemetryHooks(
  proc: Pick<HostProcess, "env" | "cwd" | "stderr">,
  options?: TelemetryWiringOptions,
): CliRunHooks | undefined {
  const inCI = options?.inCI ?? isCI();
  if (inCI) {
    return undefined;
  }
  const userConfig = readUserConfig();
  if (!resolveGating({ env: proc.env, config: userConfig }).enabled) {
    return undefined;
  }
  const fire = options?.fire ?? runTelemetry;
  return {
    onSettled: (summary) => {
      try {
        if (summary.snapshot.commandPath[0] === "telemetry") {
          return;
        }
        let config: UserConfig = userConfig;
        const storedId = config.installationId;
        if (typeof storedId !== "string" || storedId.length === 0) {
          const installationId = discloseAndMintOnFirstRun(proc.stderr);
          if (installationId !== undefined) {
            config = { ...config, installationId };
          }
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
