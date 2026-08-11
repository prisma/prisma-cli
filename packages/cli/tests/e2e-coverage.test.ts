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
};

/**
 * Commands that were already mounted when this convention arrived and
 * still need a happy path written. This is a backlog, not a second
 * exclusions list: every entry is work owed, and nothing new belongs
 * here. A command added from today on needs a test or an EXCLUSIONS
 * entry saying why it cannot have one.
 *
 * `service` and `build` act on a deployed service, which Composer
 * creates and this repo cannot; covering them needs a fixture service
 * that outlives a CI run. `agent` writes local agent context files and
 * should be straightforward to cover.
 */
const AWAITING_COVERAGE: readonly string[] = [
  "service show",
  "service open",
  "service list-deploys",
  "service show-deploy",
  "service promote",
  "service rollback",
  "service remove",
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

async function coveredCommands(): Promise<Map<string, string[]>> {
  const entries = await readdir(E2E_DIR);
  const covered = new Map<string, string[]>();
  for (const entry of entries.filter((name) => name.endsWith(".e2e.ts"))) {
    const source = await readFile(path.join(E2E_DIR, entry), "utf8");
    for (const match of source.matchAll(/describeCommand\(\s*"([^"]+)"/g)) {
      const command = match[1] as string;
      covered.set(command, [...(covered.get(command) ?? []), entry]);
    }
  }
  return covered;
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

  it("finds the command registry and the e2e suite at all", async () => {
    // Guards the parsing above: a rename that silently produced an
    // empty list would make every assertion here vacuously pass.
    expect((await mountedCommands()).length).toBeGreaterThan(30);
    expect((await coveredCommands()).size).toBeGreaterThan(20);
  });
});
