import { defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { readSkillsStatus } from "../../lib/skills/status";
import { skillsConfigSection } from "./config";
import { listPresentations } from "./presentation";
import type { SkillsListResult } from "./results";
import { packageReports, versionConflictDiagnostics } from "./sync";

export const skillsListCommand = defineCommand({
  help: {
    summary: "Show which Prisma agent skills are installed in this project",
    examples: ["skills list", "skills list --json"],
  },
  needs: { config: skillsConfigSection },
  handler: async (_args, ctx) => {
    const status = await readSkillsStatus(ctx.cwd, {
      agents: ctx.config.agents,
    });
    const result: SkillsListResult = {
      projectRoot: status.projectRoot,
      agents: ctx.config.agents,
      packages: packageReports(status.packages),
      skills: status.skills.map((skill) => ({
        skill: skill.skill,
        library: skill.library,
        version: skill.version,
        upToDate: skill.upToDate,
        targets: skill.targets.map((target) => ({
          dir: target.dir,
          syncedVersion: target.syncedVersion,
          state: target.state,
        })),
      })),
      orphaned: status.orphans.map((orphan) => ({
        skill: orphan.skill,
        library: orphan.library,
        dirs: orphan.dirs,
      })),
      checkDisabled: status.checkDisabled || !ctx.config.check,
      upToDate: status.upToDate,
    };

    return ok(
      ctx.present(
        {
          data: result,
          diagnostics: versionConflictDiagnostics(status.packages),
        },
        listPresentations(result),
      ),
    );
  },
});
