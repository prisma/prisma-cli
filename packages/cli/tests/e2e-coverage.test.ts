/**
 * The convention, enforced: every command mounted in the binary must
 * have at least one real-API happy path in `e2e/`.
 *
 * This runs in the ordinary unit suite, with no credentials, so adding
 * a command without an end-to-end test fails the pull request that adds
 * it rather than being noticed a year later.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const CLI_SOURCE = path.resolve(import.meta.dirname, "../src/v8/cli.ts");
const E2E_DIR = path.resolve(import.meta.dirname, "../e2e");

/**
 * Commands with no real-API happy path, and why. Every entry is a gap
 * with a reason, not a permanent exemption — an exclusion whose command
 * has been deleted fails this test, so the list cannot rot quietly.
 */
const EXCLUSIONS: Readonly<Record<string, string>> = {
  "auth login":
    "Interactive browser OAuth. There is no non-interactive path to a real sign-in, so CI cannot drive it.",
  "auth workspace use":
    "Selects among stored OAuth sessions. A service-token host has none, and CI cannot mint OAuth sessions.",
  "auth workspace logout":
    "Ends a stored OAuth session. Same reason as `auth workspace use`.",
  "project transfer":
    "Irreversibly moves a project to another workspace, and needs a second workspace plus a recipient who accepts. Not safe to run unattended.",
  "postgres restore":
    "Needs an existing backup. Backups are created on the platform's own schedule, so a database made during the run never has one.",
  "git connect":
    "Needs a GitHub App installation on the account under test, which CI cannot provision.",
  "git disconnect":
    "Needs a connected repository, which `git connect` cannot create here.",
  "composer deploy":
    "Provisions real cloud infrastructure for an app entry point, through a child `alchemy deploy`. Standing that up per CI run is neither cheap nor unattended-safe.",
  "composer destroy":
    "Tears down what `composer deploy` provisioned, which this suite cannot create.",
  "composer dev":
    "A session command: it runs until SIGINT or SIGTERM, redeploying on file change, so it has no happy path that terminates on its own.",
  "composer log":
    "A session command that streams until interrupted, against an app only `composer deploy` could have deployed.",
};

/**
 * Commands that were already mounted when this convention arrived and
 * still need a happy path written. This is a backlog, not a second
 * exclusions list: every entry is work owed, and nothing new belongs
 * here. A command added from today on needs a test or an EXCLUSIONS
 * entry saying why it cannot have one.
 *
 * The `service` and `build` entries left here act on a service that has
 * been DEPLOYED, which Composer does and this repo cannot; covering them
 * needs a fixture service that outlives a CI run. Commands that only
 * need the service to exist are no longer among them: `service create`
 * makes one without deploying, which is how `service remove` got its
 * happy path. `agent` writes local agent context files and should be
 * straightforward to cover.
 */
const AWAITING_COVERAGE: readonly string[] = [
  "service show",
  "service open",
  "service deployment list",
  "service deployment show",
  "service deployment promote",
  "service deployment rollback",
  "service domain add",
  "service domain show",
  "service domain remove",
  "service domain retry",
  "service domain wait",
  "build logs",
  "agent install",
  "agent update",
  "agent status",
];

async function mountedCommands(): Promise<string[]> {
  const source = await readFile(CLI_SOURCE, "utf8");
  const marker = "mountedCommands: Readonly<Record<string, AnyCommand>> = {";
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`could not find mountedCommands in ${CLI_SOURCE}`);
  }
  const end = source.indexOf("\n};", start);
  if (end === -1) {
    throw new Error(
      `could not find the end of mountedCommands in ${CLI_SOURCE}. Without ` +
        "it the scan runs to the end of the file and reports every other " +
        "object literal's keys as commands.",
    );
  }
  const block = source.slice(start + marker.length, end);
  return [...block.matchAll(/^\s*"([^"]+)":/gm)].map(
    (match) => match[1] as string,
  );
}

async function readSuites(): Promise<Array<{ entry: string; source: string }>> {
  const entries = await readdir(E2E_DIR);
  return Promise.all(
    entries
      .filter((name) => name.endsWith(".e2e.ts"))
      .map(async (entry) => ({
        entry,
        source: await readFile(path.join(E2E_DIR, entry), "utf8"),
      })),
  );
}

async function coveredCommands(): Promise<Map<string, string[]>> {
  const suites = await readSuites();

  const covered = new Map<string, string[]>();
  for (const { entry, source } of suites) {
    for (const match of source.matchAll(/describeCommand\(\s*"([^"]+)"/g)) {
      const command = match[1] as string;
      covered.set(command, [...(covered.get(command) ?? []), entry]);
    }
  }
  return covered;
}

const ASSERTION = /expect\(([^\n]*)/g;
const ENVELOPE_OK_ASSERTION = /^\s*run\d*\.envelope\.ok\s*\)/;
const EXIT_CODE_ASSERTION = /^\s*run\d*\.exitCode\s*\)/;

/** Each `describeCommand("x", () => { … })` in a file, as the command it
 *  names plus the source between it and the next one. Good enough to
 *  attribute assertions to a command without parsing TypeScript. */
function splitDescribeCommandBlocks(
  source: string,
): Array<{ command: string; body: string }> {
  const starts = [...source.matchAll(/describeCommand\(\s*"([^"]+)"/g)];
  return starts.map((match, index) => ({
    command: match[1] as string,
    body: source.slice(
      match.index,
      index + 1 < starts.length ? starts[index + 1]?.index : undefined,
    ),
  }));
}

describe("real-API end-to-end coverage", () => {
  it("covers every mounted command, or excludes it with a reason", async () => {
    const mounted = await mountedCommands();
    const covered = await coveredCommands();

    const uncovered = mounted.filter(
      (command) =>
        !covered.has(command) &&
        EXCLUSIONS[command] === undefined &&
        !AWAITING_COVERAGE.includes(command),
    );

    expect(
      uncovered,
      "Every command in the binary needs a real-API happy path in " +
        "packages/cli/e2e (see AGENTS.md). Add a describeCommand(...) for " +
        "it, or add it to EXCLUSIONS here with the reason it cannot be " +
        `tested against the real API. Missing: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  it("has no exclusion or backlog entry for a command that no longer exists", async () => {
    const mounted = new Set(await mountedCommands());
    const stale = [...Object.keys(EXCLUSIONS), ...AWAITING_COVERAGE].filter(
      (command) => !mounted.has(command),
    );

    expect(stale, `stale entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("does not leave a command both covered and listed as owed", async () => {
    const covered = await coveredCommands();
    const done = AWAITING_COVERAGE.filter((command) => covered.has(command));

    expect(
      done,
      `these now have tests and should be removed from AWAITING_COVERAGE: ${done.join(", ")}`,
    ).toEqual([]);
  });

  it("does not declare the same command in two files", async () => {
    const covered = await coveredCommands();
    const duplicated = [...covered.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([command, files]) => `${command} (${files.join(", ")})`);

    expect(duplicated).toEqual([]);
  });

  /**
   * A happy path that only checks `envelope.ok` or `exitCode` proves the
   * command returned, and nothing about what it returned. `auth whoami`
   * showed why: with no credential at all it answers ok, with
   * `authenticated: false` and exit 0, so the weak form passed on a CLI
   * that had authenticated nobody. Every block must read something out
   * of the result.
   */
  it("has no happy path that only checks ok or exitCode", async () => {
    const suites = await readSuites();
    const weak: string[] = [];

    for (const { entry, source } of suites) {
      for (const block of splitDescribeCommandBlocks(source)) {
        const assertions = [...block.body.matchAll(ASSERTION)].map(
          (match) => match[1] as string,
        );
        const substantive = assertions.filter(
          (assertion) =>
            !ENVELOPE_OK_ASSERTION.test(assertion) &&
            !EXIT_CODE_ASSERTION.test(assertion),
        );
        if (assertions.length > 0 && substantive.length === 0) {
          weak.push(`${entry}: ${block.command}`);
        }
      }
    }

    expect(
      weak,
      "These read nothing out of the result, so they pass on any " +
        `successful response: ${weak.join(", ")}`,
    ).toEqual([]);
  });

  it("finds the command registry and the e2e suite at all", async () => {
    // Guards the parsing above: a rename that silently produced an
    // empty list would make every assertion here vacuously pass.
    expect((await mountedCommands()).length).toBeGreaterThan(30);
    expect((await coveredCommands()).size).toBeGreaterThan(20);
  });
});
