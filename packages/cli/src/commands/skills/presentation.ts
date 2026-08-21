import type { Block, Presentations } from "@prisma/cli-engine";
import type { NextAction } from "@prisma/cli-engine/protocol";
import type { SkillsListResult, SkillsSyncResult } from "./results";

/** Sync never edits package.json; resyncing on install is the user's
 *  choice, and the staleness notice covers projects that skip it. */
const POSTINSTALL_ADVICE: NextAction = {
  kind: "user-choice",
  label:
    'Optional: add "postinstall": "prisma skills sync || exit 0" to your root package.json to resync on every install. Without it, the CLI prints a notice when the skills go out of date.',
};

function projectFields(projectRoot: string, checkDisabled: boolean): Block {
  return {
    kind: "fields",
    rows: [
      { label: "project", value: projectRoot },
      { label: "check", value: checkDisabled ? "disabled" : "enabled" },
    ],
  };
}

function syncSummary(result: SkillsSyncResult): string {
  if (result.packages.length === 0) {
    return "No Prisma packages with agent skills are installed.";
  }
  if (result.synced.length === 0 && result.pruned.length === 0) {
    return "Agent skills are up to date.";
  }
  const synced = `${result.synced.length} skill${result.synced.length === 1 ? "" : "s"}`;
  return result.pruned.length === 0
    ? `Synced ${synced}.`
    : `Synced ${synced} and removed ${result.pruned.length}.`;
}

export function syncPresentations(result: SkillsSyncResult): Presentations {
  const syncedRows = result.synced.map((skill) => [
    skill.skill,
    skill.library,
    skill.version,
    skill.dirs.join(", "),
  ]);
  const prunedRows = result.pruned.map((skill) => [
    skill.skill,
    skill.dirs.join(", "),
  ]);

  return {
    json: () => result,
    next: () => (result.packages.length > 0 ? [POSTINSTALL_ADVICE] : []),
    human: (): Block[] => [
      {
        kind: "summary",
        status: result.synced.length > 0 ? "ok" : "info",
        text: syncSummary(result),
      },
      projectFields(result.projectRoot, result.checkDisabled),
      ...(syncedRows.length === 0
        ? []
        : [
            {
              kind: "table" as const,
              columns: ["Skill", "Package", "Version", "Installed into"],
              rows: syncedRows,
            },
          ]),
      ...(prunedRows.length === 0
        ? []
        : [
            {
              kind: "table" as const,
              columns: ["Removed skill", "Removed from"],
              rows: prunedRows,
            },
          ]),
    ],
    stdout: () => syncedRows.map((row) => row.join("\t")),
  };
}

function listSummary(result: SkillsListResult): string {
  if (result.skills.length === 0) {
    return "No Prisma agent skills are available to sync.";
  }
  return result.upToDate
    ? "Agent skills are up to date."
    : "Agent skills are out of date.";
}

export function listPresentations(result: SkillsListResult): Presentations {
  const rows = result.skills.flatMap((skill) =>
    skill.targets.map((target) => [
      skill.skill,
      skill.library,
      skill.version,
      target.dir,
      target.syncedVersion ?? "-",
      target.state,
    ]),
  );

  return {
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      { kind: "summary", status: "info", text: listSummary(result) },
      projectFields(result.projectRoot, result.checkDisabled),
      ...(rows.length === 0
        ? []
        : [
            {
              kind: "table" as const,
              columns: [
                "Skill",
                "Package",
                "Installed",
                "Directory",
                "Synced",
                "State",
              ],
              rows,
            },
          ]),
    ],
    stdout: () => rows.map((row) => row.join("\t")),
  };
}
