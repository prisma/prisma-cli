import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { deployFailedError, runCommandAction } from "./errors";
import {
  versionStartPresentations,
  versionStopPresentations,
} from "./presentation";
import type { ServiceVersionRunStateResult } from "./results";
import type { ServiceContext } from "./target";
import { resolveVersionSubject, toServiceSummary } from "./target";

/**
 * `start` and `stop` are the same command with the direction reversed,
 * so the verb decides every value that differs between them. Spelling
 * that out here keeps the two from drifting apart, which is the risk
 * with a body this long duplicated.
 */
const VERBS = {
  start: {
    /** The status the API reports once the version is up. */
    settledStatus: "running",
    diagnosticCode: "SERVICE.VERSION_ALREADY_RUNNING",
    diagnosticSummary: "The selected version is already running.",
    failureSummary: "Failed to start version",
    presentations: versionStartPresentations,
  },
  stop: {
    settledStatus: "stopped",
    diagnosticCode: "SERVICE.VERSION_ALREADY_STOPPED",
    diagnosticSummary: "The selected version is already stopped.",
    failureSummary: "Failed to stop version",
    presentations: versionStopPresentations,
  },
} as const;

export type RunStateVerb = keyof typeof VERBS;

export interface RunStateOutcome {
  result: ServiceVersionRunStateResult;
  diagnostics: Diagnostic[];
  presentations: ReturnType<typeof versionStartPresentations>;
}

export async function changeVersionRunState(
  ctx: ServiceContext,
  versionId: string,
  verb: RunStateVerb,
): Promise<RunStateOutcome> {
  const spec = VERBS[verb];
  const { provider, service, version } = await resolveVersionSubject(
    ctx,
    versionId,
  );
  const alreadyInState = version.status === spec.settledStatus;

  let observed = version;
  if (!alreadyInState) {
    ctx.report({ kind: "step-started", step: verb });
    try {
      // The API requires a version's artifact to be uploaded before
      // it will start. That refusal is the API's to make and its message
      // is carried through, rather than the CLI guessing at the
      // precondition itself.
      await (verb === "start"
        ? provider.startDeployment({
            deploymentId: version.id,
            signal: ctx.signal,
          })
        : provider.stopDeployment({
            deploymentId: version.id,
            signal: ctx.signal,
          }));
      // The start and stop endpoints answer with nothing, so the status
      // is read back rather than assumed. A version still coming up
      // reports whatever state it is actually in.
      observed = await provider.readDeployment({
        deploymentId: version.id,
        signal: ctx.signal,
      });
    } catch (error) {
      ctx.report({ kind: "step-finished", step: verb, outcome: "failed" });
      throw deployFailedError(spec.failureSummary, error, [
        runCommandAction(
          "Show the version",
          `service version show ${version.id}`,
        ),
      ]);
    }
    ctx.report({ kind: "step-finished", step: verb, outcome: "ok" });
  }

  const result: ServiceVersionRunStateResult = {
    service: toServiceSummary(service),
    version: observed,
    alreadyInState,
  };
  const diagnostics: Diagnostic[] = alreadyInState
    ? [
        {
          code: spec.diagnosticCode,
          severity: "warn",
          summary: spec.diagnosticSummary,
          nextActions: [],
        },
      ]
    : [];
  return { result, diagnostics, presentations: spec.presentations(result) };
}
