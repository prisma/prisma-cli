import { defineCommand, flag } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { writeSkillsCheckDisabled } from "../../lib/skills/opt-out";
import type { InstalledSourcePackage } from "../../lib/skills/status";
import { readSkillsStatus } from "../../lib/skills/status";
import { syncSkills } from "../../lib/skills/sync";
import { syncPresentations } from "./presentation";
import type { SkillsPackageReport, SkillsSyncResult } from "./results";

export function packageReports(
  packages: readonly InstalledSourcePackage[],
): SkillsPackageReport[] {
  return packages.map((installed) => ({
    package: installed.name,
    version: installed.version,
    conflictingVersions: installed.conflictingVersions,
  }));
}

/** Workspace members that pin different versions of the same
 *  skill-bearing package: the highest wins, and the user hears about
 *  it, because the losing members get a skill describing a version
 *  they did not install. */
export function versionConflictDiagnostics(
  packages: readonly InstalledSourcePackage[],
): Diagnostic[] {
  return packages
    .filter((installed) => installed.conflictingVersions.length > 1)
    .map((installed) => ({
      code: "SKILLS.VERSION_CONFLICT",
      severity: "warn" as const,
      summary: `Workspace members install different versions of ${installed.name} (${installed.conflictingVersions.join(", ")}); the skills for ${installed.version} were installed.`,
      nextActions: [
        {
          kind: "user-choice" as const,
          label: `Pin one version of ${installed.name} across the workspace.`,
        },
      ],
    }));
}

function bothSwitchesError(): CliStructuredError {
  return new CliStructuredError(
    "CLI.INVALID_ARGUMENTS",
    "--disable and --enable ask for opposite things, so only one may be given.",
    {
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Run with --disable to silence the skills check, or --enable to restore it.",
        },
      ],
    },
  );
}

export const skillsSyncCommand = defineCommand({
  help: {
    summary:
      "Copy the agent skills from installed Prisma packages into this project",
    description:
      "Skills come from the Prisma packages the project installs, so they always describe the version in use. Sync copies them into the skill directories the agent harnesses read, and removes copies whose package is gone. It does nothing, and exits 0, when everything is already current.",
    examples: ["skills sync", "skills sync --disable"],
  },
  args: {
    flags: {
      disable: flag.boolean({
        brief:
          "Stop other commands reporting out-of-date skills in this project",
      }),
      enable: flag.boolean({
        brief: "Undo --disable for this project",
      }),
    },
  },
  handler: async (args, ctx) => {
    if (args.flags.disable && args.flags.enable) {
      return notOk(bothSwitchesError());
    }

    const status = await readSkillsStatus(ctx.cwd);
    const outcome = await syncSkills(status);

    let checkDisabled = outcome.checkDisabled;
    if (args.flags.disable || args.flags.enable) {
      checkDisabled = args.flags.disable;
      await writeSkillsCheckDisabled(outcome.projectRoot, checkDisabled);
    }

    const result: SkillsSyncResult = {
      projectRoot: outcome.projectRoot,
      packages: packageReports(outcome.packages),
      synced: outcome.synced,
      pruned: outcome.pruned,
      checkDisabled,
    };

    return ok(
      ctx.present(
        {
          data: result,
          diagnostics: versionConflictDiagnostics(outcome.packages),
        },
        syncPresentations(result),
      ),
    );
  },
});
