import { resolveIsCI } from "../ci";
import type { EngineCommandSnapshot } from "../run-summary";
import type { Runtime } from "../runtime";
import { resolveTelemetryEndpoint } from "./endpoint";
import { resolveGating } from "./gating";
import { composeTelemetryPayload } from "./payload";
import {
  ensureInstallationId,
  readUserConfig,
  userConfigPath,
} from "./user-config";

/**
 * What a CLI declares to report. One field: the endpoint, the opt-out
 * variable names, the config path and the disclosure wording are Prisma
 * constants the engine owns. Omitting the declaration means the CLI
 * reports nothing at all.
 */
export interface TelemetryDeclaration {
  /** Named in the first-run disclosure as where to read what is collected. */
  readonly docsUrl: string;
}

/** The Runtime members reporting reads. */
export type TelemetryHost = Pick<
  Runtime,
  "env" | "cwd" | "stderr" | "isCIOverride" | "spawnTelemetry"
>;

export interface TelemetryReportInputs {
  readonly host: TelemetryHost;
  readonly telemetry: TelemetryDeclaration;
  /** The CLI's own name and version, from `createCli`. */
  readonly name: string;
  readonly version: string;
  readonly snapshot: EngineCommandSnapshot;
}

/**
 * The command path the whole telemetry surface is exempt from. Running
 * `telemetry disable` must not report a usage event on its way to
 * disabling, and `telemetry status` must not mint an id while merely
 * reporting state.
 */
const EXEMPT_COMMAND = "telemetry";

/**
 * The one-time first-run disclosure. `<name> telemetry disable` is named
 * as the primary, friendliest opt-out, alongside the environment
 * variables. The config file is not named and hand-editing it is not
 * suggested: the preference is machine-edited, which is what the
 * telemetry commands are for, and `telemetry status` reports the path
 * for anyone who wants it.
 */
export function firstRunNotice(cliName: string, docsUrl: string): string {
  return [
    "Prisma collects anonymous CLI usage data, enabled by default.",
    `What's collected and why: ${docsUrl}.`,
    `Opt out: run "${cliName} telemetry disable", set DO_NOT_TRACK=1 or`,
    "PRISMA_DISABLE_TELEMETRY=1.",
  ].join(" ");
}

/**
 * The first enabled run on this machine: disclose, then mint. Both are
 * best-effort. A failed write returns no id, which skips the event
 * rather than sending a junk one, and leaves the notice to print again
 * next run — the stored id is what makes it print exactly once.
 */
function discloseAndMint(inputs: TelemetryReportInputs): string | undefined {
  const { host } = inputs;
  try {
    host.stderr.write(
      `${firstRunNotice(inputs.name, inputs.telemetry.docsUrl)}\n`,
    );
  } catch {
    // An unwritable stderr must not cost the run its command.
  }
  try {
    return ensureInstallationId(host.env);
  } catch {
    return undefined;
  }
}

/**
 * Report one run, at command start — before the handler, from the
 * parse-time snapshot. Exempt the telemetry command, resolve gating,
 * disclose and mint on a first enabled run, compose, hand the payload to
 * the host's seam. The engine composes; the host spawns.
 *
 * A host with no seam is turned away first, before the config is even
 * read: a CLI that cannot deliver an event must not tell the user it
 * collects data, and must not mint an installation id it has no use
 * for. Declaring telemetry and wiring the seam are two halves of one
 * decision; either one missing means the run reports nothing. An
 * environment that says nothing about where the user's config lives is
 * turned away at the same point and for the same reason.
 *
 * Every failure is swallowed: a malformed stored config, an unwritable
 * config directory and a throwing seam all leave the run's exit code,
 * stdout and stderr exactly as they would have been.
 */
export function reportCommandStart(inputs: TelemetryReportInputs): void {
  try {
    const { host, snapshot } = inputs;
    const deliver = host.spawnTelemetry;
    const configPath = userConfigPath(host.env);
    if (
      deliver === undefined ||
      configPath === undefined ||
      snapshot.commandPath[0] === EXEMPT_COMMAND
    ) {
      return;
    }
    const config = readUserConfig(host.env);
    if (
      !resolveGating({ env: host.env, config, inCI: resolveIsCI(host) }).enabled
    ) {
      return;
    }
    const stored = config.installationId;
    const installationId =
      typeof stored === "string" && stored.length > 0
        ? stored
        : discloseAndMint(inputs);
    if (installationId === undefined) {
      return;
    }
    deliver(
      composeTelemetryPayload({
        installationId,
        version: inputs.version,
        projectRoot: host.cwd,
        endpoint: resolveTelemetryEndpoint(host.env),
        snapshot,
      }),
    );
  } catch {
    // Telemetry must never break a command.
  }
}
