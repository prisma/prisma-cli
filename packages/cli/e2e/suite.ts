/**
 * `describeCommand` is both the suite's entry point and the marker the
 * coverage check reads. Every command mounted in the binary must appear
 * in exactly one `describeCommand(...)` call, or `tests/e2e-coverage`
 * fails — on every pull request, with no credentials needed.
 */
import { describe } from "vitest";

import {
  type E2eSession,
  e2eCredentials,
  E2eSession as Session,
} from "./harness";

let opened: Promise<E2eSession> | undefined;

/** The shared session. Lazily opened on first use and left for the
 *  process to drop: its only resource is a temp directory. */
export function session(): Promise<E2eSession> {
  const credentials = e2eCredentials();
  if (credentials === null) {
    throw new Error("no e2e credentials; this suite should have been skipped");
  }
  opened ??= Session.open(credentials);
  return opened;
}

export function hasCredentials(): boolean {
  return e2eCredentials() !== null;
}

/**
 * Declares the real-API happy path for one mounted command.
 *
 * Skips when no credential is configured, so a contributor without one
 * still gets a green suite — except in CI, where PRISMA_E2E_REQUIRED=1
 * turns the missing credential into a failure instead.
 */
export function describeCommand(command: string, define: () => void): void {
  const run = hasCredentials() ? describe : describe.skip;
  run(`prisma ${command}`, define);
}

/** Suites that share one scratch project rather than one per command. */
export function describeCommands(
  commands: readonly string[],
  define: () => void,
): void {
  const run = hasCredentials() ? describe : describe.skip;
  run(`prisma ${commands.join(" + ")}`, define);
}
