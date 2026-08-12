/**
 * The `INIT.*` error vocabulary. Each constructor carries the legacy
 * summary and why text unchanged (R-S2b-5); the legacy `fix` prose
 * becomes a `user-choice` next action and the legacy `nextSteps` become
 * `run-command` ones.
 */
import {
  CliStructuredError,
  type NextAction,
} from "@prisma/cli-engine/protocol";

export function initError(spec: {
  readonly code: `INIT.${string}`;
  readonly summary: string;
  readonly why: string;
  readonly fix: string;
  readonly commands?: readonly string[];
  readonly where?: string;
  readonly meta?: Record<string, unknown>;
}): CliStructuredError {
  const nextActions: NextAction[] = [
    { kind: "user-choice", label: spec.fix },
    ...(spec.commands ?? []).map(
      (command): NextAction => ({
        kind: "run-command",
        label: command,
        command,
      }),
    ),
  ];
  return new CliStructuredError(spec.code, spec.summary, {
    why: spec.why,
    nextActions,
    ...(spec.where === undefined ? {} : { where: { path: spec.where } }),
    ...(spec.meta === undefined ? {} : { meta: spec.meta }),
  });
}
