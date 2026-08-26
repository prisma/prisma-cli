import type { Block, Presentations } from "@prisma/cli-engine";
import type { SkillsListResult, SkillsSyncResult } from "./results";

function projectFields(projectRoot: string, checkDisabled: boolean): Block {
  return {
    kind: "fields",
    rows: [
      { label: "project", value: projectRoot },
      { label: "check", value: checkDisabled ? "disabled" : "enabled" },
    ],
  };
}

/** Decision B: "up to date" may not over-claim — when directories were
 *  refused, the summary says so in the same line, for sync and list
 *  alike. */
function unmanagedClause(count: number): string {
  if (count === 0) {
    return "";
  }
  return count === 1
    ? "; 1 directory is not managed by this CLI"
    : `; ${count} directories are not managed by this CLI`;
}

function syncSummary(result: SkillsSyncResult): string {
  // The empty-state sentences hold only when this run also removed
  // nothing; a prune is work done, and its summary must match the
  // Removed table rendered beneath it.
  if (result.pruned.length === 0) {
    if (result.agents.length === 0) {
      return "No agents are configured to sync skills for.";
    }
    if (result.packages.length === 0) {
      return "No Prisma packages with agent skills are installed.";
    }
    if (result.skills.length === 0) {
      return "No Prisma dependencies in your project ship agent skills to sync.";
    }
  }
  const refusedDirs = result.refused.reduce(
    (count, skill) => count + skill.dirs.length,
    0,
  );
  if (result.synced.length === 0 && result.pruned.length === 0) {
    return `Agent skills are up to date${unmanagedClause(refusedDirs)}.`;
  }
  const removed = `${result.pruned.length} skill${result.pruned.length === 1 ? "" : "s"}`;
  if (result.synced.length === 0 && result.pruned.length > 0) {
    return `Removed ${removed}${unmanagedClause(refusedDirs)}.`;
  }
  const synced = `${result.synced.length} skill${result.synced.length === 1 ? "" : "s"}`;
  const base =
    result.pruned.length === 0
      ? `Synced ${synced}`
      : `Synced ${synced} and removed ${result.pruned.length}`;
  return `${base}${unmanagedClause(refusedDirs)}.`;
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
  const refusedRows = result.refused.map((skill) => [
    skill.skill,
    skill.dirs.join(", "),
  ]);

  return {
    json: () => result,
    next: () => [],
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
      ...(refusedRows.length === 0
        ? []
        : [
            {
              kind: "table" as const,
              columns: ["Unmanaged skill", "Left untouched in"],
              rows: refusedRows,
            },
          ]),
    ],
    stdout: () => syncedRows.map((row) => row.join("\t")),
  };
}

function listSummary(result: SkillsListResult): string {
  if (result.agents.length === 0) {
    return "No agents are configured to sync skills for.";
  }
  if (result.packages.length === 0) {
    return "No Prisma packages with agent skills are installed.";
  }
  if (result.skills.length === 0) {
    return "No Prisma dependencies in your project ship agent skills.";
  }
  if (!result.upToDate) {
    return "Agent skills are out of date.";
  }
  const unmanaged = result.skills
    .flatMap((skill) => skill.targets)
    .filter((target) => target.state === "unmanaged").length;
  return `Agent skills are up to date${unmanagedClause(unmanaged)}.`;
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
