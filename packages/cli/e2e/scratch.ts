/**
 * A real project, created for one test file and removed afterwards.
 *
 * Mutating commands need somewhere safe to work. Everything created
 * here is named with the `e2e-` prefix, and teardown only ever removes
 * what it created — a failing test must never take a human's project
 * with it.
 */
import { afterAll, beforeAll } from "vitest";

import type { CliRun, RunOptions } from "./harness";
import { isScratchName, scratchName } from "./harness";
import { session } from "./suite";

export interface ScratchProject {
  readonly id: string;
  readonly name: string;
  /** A working directory already linked to this project, so commands
   *  that resolve from `.prisma/local.json` work without `--project`. */
  readonly cwd: string;
}

/**
 * Removes a project created by a test, reporting every way it can fail
 * and raising none of them. Shared so that no cleanup path has to
 * remember this on its own.
 */
export async function removeScratchProject(
  cli: {
    run: (args: readonly string[], options?: RunOptions) => Promise<CliRun>;
  },
  project: { readonly id: string; readonly name: string; readonly cwd: string },
): Promise<void> {
  const stranded = (detail: string) =>
    console.warn(
      `e2e teardown could not remove ${project.name} (${project.id}): ` +
        `${detail}. It is still in the workspace and needs removing by hand.`,
    );
  try {
    const removal = await cli.run(
      ["project", "remove", project.id, "--confirm", project.id],
      { cwd: project.cwd, expectOk: false },
    );
    if (!removal.envelope.ok) {
      stranded(
        `${removal.envelope.error?.code ?? "(no code)"} — ` +
          `${removal.envelope.error?.summary ?? "(no summary)"}`,
      );
    }
  } catch (failure) {
    // A timeout or an unreadable stream lands here rather than in the
    // envelope, and must not escape a teardown.
    stranded(failure instanceof Error ? failure.message : String(failure));
  }
}

export interface ScratchHandle {
  project: () => ScratchProject;
  /** Runs the CLI in the linked working directory. */
  run: (args: readonly string[], options?: RunOptions) => Promise<CliRun>;
}

/**
 * Registers the create/remove lifecycle for the calling test file.
 * Call at file top level, outside any `describe`.
 */
export function useScratchProject(label: string): ScratchHandle {
  let created: ScratchProject | undefined;

  beforeAll(async () => {
    const cli = await session();
    const cwd = await cli.workdir();
    const name = scratchName(label);

    const run = await cli.run(["project", "create", name], { cwd });
    const result = run.envelope.result as {
      readonly project: { readonly id: string; readonly name: string };
    };
    created = { id: result.project.id, name: result.project.name, cwd };
  });

  afterAll(async () => {
    if (created === undefined) return;
    if (!isScratchName(created.name)) {
      throw new Error(
        `refusing to remove "${created.name}": not an e2e scratch project`,
      );
    }
    // Removal is permanent, so the CLI demands the project id back as
    // consent; --yes deliberately cannot grant it.
    //
    // Teardown must not throw — that would mask whatever the test
    // itself found — but it must not go unrecorded either: a silent
    // failure leaves the project in the real workspace, and each failing
    // run adds another. `expectOk: false` alone is not enough, because
    // run() still throws on a timeout or an unreadable stream.
    const cli = await session();
    await removeScratchProject(cli, created);
  });

  const project = () => {
    if (created === undefined) {
      throw new Error("the scratch project is not created yet");
    }
    return created;
  };

  return {
    project,
    run: async (args, options) => {
      const cli = await session();
      return cli.run(args, { cwd: project().cwd, ...options });
    },
  };
}
