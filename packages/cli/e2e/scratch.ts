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
import { SCRATCH_PREFIX, scratchName } from "./harness";
import { session } from "./suite";

export interface ScratchProject {
  readonly id: string;
  readonly name: string;
  /** A working directory already linked to this project, so commands
   *  that resolve from `.prisma/local.json` work without `--project`. */
  readonly cwd: string;
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
    if (!created.name.startsWith(SCRATCH_PREFIX)) {
      throw new Error(
        `refusing to remove "${created.name}": not an e2e scratch project`,
      );
    }
    // Removal is permanent, so the CLI demands the project id back as
    // consent; --yes deliberately cannot grant it.
    const cli = await session();
    await cli.run(["project", "remove", created.id, "--confirm", created.id], {
      cwd: created.cwd,
      expectOk: false,
    });
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
