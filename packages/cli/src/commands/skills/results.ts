import type { PrunedSkill, SyncedSkill } from "../../lib/skills/sync";

export interface SkillsPackageReport {
  readonly package: string;
  readonly version: string;
  /** Present when workspace members resolve different versions of the
   *  same package; the highest of them is the one that was synced. */
  readonly conflictingVersions: readonly string[];
}

export interface SkillsSyncResult {
  readonly projectRoot: string;
  readonly packages: readonly SkillsPackageReport[];
  readonly synced: readonly SyncedSkill[];
  readonly pruned: readonly PrunedSkill[];
  readonly checkDisabled: boolean;
}

export interface SkillsListTarget {
  readonly dir: string;
  readonly syncedVersion: string | null;
  readonly state: "synced" | "stale" | "absent";
}

export interface SkillsListEntry {
  readonly skill: string;
  readonly library: string;
  readonly version: string;
  readonly upToDate: boolean;
  readonly targets: readonly SkillsListTarget[];
}

export interface SkillsListResult {
  readonly projectRoot: string;
  readonly packages: readonly SkillsPackageReport[];
  readonly skills: readonly SkillsListEntry[];
  /** Copies from an allowlisted package that nothing installed still
   *  provides; the next sync removes them. */
  readonly orphaned: readonly {
    readonly skill: string;
    readonly library: string | null;
    readonly dirs: readonly string[];
  }[];
  readonly checkDisabled: boolean;
  readonly upToDate: boolean;
}
