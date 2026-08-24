import type { AgentName } from "../../lib/skills/allowlist";
import type {
  PrunedSkill,
  RefusedSkill,
  SyncedSkill,
} from "../../lib/skills/sync";

export interface SkillsPackageReport {
  readonly package: string;
  readonly version: string;
  /** Present when workspace members resolve different versions of the
   *  same package; the highest of them is the one that was synced. */
  readonly conflictingVersions: readonly string[];
}

export interface SkillsSyncResult {
  readonly projectRoot: string;
  /** The agents whose directories this run covered. Empty when the
   *  config records `agents: []` — no skills are wanted. */
  readonly agents: readonly AgentName[];
  readonly packages: readonly SkillsPackageReport[];
  /** Every skill name the installed packages ship, whether or not this
   *  run wrote it. Empty while `packages` is not means the installed
   *  versions ship no skills. */
  readonly skills: readonly string[];
  readonly synced: readonly SyncedSkill[];
  readonly pruned: readonly PrunedSkill[];
  /** Target directories left untouched because they hold a skill this
   *  CLI does not manage. */
  readonly refused: readonly RefusedSkill[];
  readonly checkDisabled: boolean;
}

export interface SkillsListTarget {
  readonly dir: string;
  readonly syncedVersion: string | null;
  readonly state: "synced" | "stale" | "absent" | "unmanaged";
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
  /** The agents whose directories this report covers. Empty when the
   *  config records `agents: []` — no skills are wanted. */
  readonly agents: readonly AgentName[];
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
