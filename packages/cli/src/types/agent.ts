export interface AgentSkillsResult {
  status: "installed" | "would-install";
  command: string[];
}

export interface AgentInstalledSkill {
  name: string;
  path: string;
  scope: string;
  agents: string[];
}

export interface AgentInstallResult {
  operation: "install" | "update";
  skills: AgentSkillsResult;
}

export interface AgentStatusResult {
  skills: AgentInstalledSkill[];
  skillsListCommand: string[];
  statusScope: "project" | "global";
  skillsLockPath: string;
  skillsLockInstalled: boolean;
  skillsInstalled: boolean;
  statusSource: "skills-cli" | "skills-lock" | "unavailable";
  promptDismissedAt: string | null;
}
