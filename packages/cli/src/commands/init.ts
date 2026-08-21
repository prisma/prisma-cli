import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Block, Presentations } from "@prisma/cli-engine";
import { defineCommand, flag } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../cli-name";
import { readSkillsStatus } from "../lib/skills/status";
import { syncSkills } from "../lib/skills/sync";
import { skillsConfigSection } from "./skills/config";
import { syncPresentations } from "./skills/presentation";
import type { SkillsSyncResult } from "./skills/results";
import { packageReports, versionConflictDiagnostics } from "./skills/sync";

export const POSTINSTALL_SCRIPT = "prisma skills sync || exit 0";

export type InitPostinstallOutcome = "added" | "exists" | "kept" | "skipped";

export interface InitPostinstallReport {
  readonly outcome: InitPostinstallOutcome;
  /** The postinstall script package.json holds after init; null when
   *  the step was skipped or nothing was written. */
  readonly script: string | null;
}

export type InitSkillsOutcome = "synced" | "up-to-date" | "failed" | "skipped";

export interface InitSkillsReport {
  readonly outcome: InitSkillsOutcome;
  readonly sync: SkillsSyncResult | null;
}

export interface InitResult {
  readonly postinstall: InitPostinstallReport;
  readonly skills: InitSkillsReport;
}

interface Step<TReport> {
  readonly report: TReport;
  /** The step's one human line; null when the skills sync ran, whose
   *  outcome renders through the shared sync presentation instead. */
  readonly line: Block | null;
  readonly diagnostics: readonly Diagnostic[];
}

function summary(status: "ok" | "info" | "warn", text: string): Block {
  return { kind: "summary", status, text };
}

const APPEND_ADVICE = {
  kind: "user-choice" as const,
  label: `Append "${POSTINSTALL_SCRIPT}" to your postinstall script yourself to resync the skills on every install.`,
};

function noPackageJsonDiagnostic(): Diagnostic {
  return {
    code: "INIT.NO_PACKAGE_JSON",
    severity: "warn",
    summary:
      "There is no package.json in this directory, so the postinstall hook was not added.",
    nextActions: [
      {
        kind: "user-choice",
        label: `Run ${CLI_NAME} init from the directory that holds your package.json.`,
      },
    ],
  };
}

function unreadablePackageJsonDiagnostic(): Diagnostic {
  return {
    code: "INIT.PACKAGE_JSON_UNREADABLE",
    severity: "warn",
    summary:
      "package.json could not be parsed, so the postinstall hook was not added.",
    nextActions: [APPEND_ADVICE],
  };
}

function foreignPostinstallDiagnostic(): Diagnostic {
  return {
    code: "INIT.POSTINSTALL_KEPT",
    severity: "warn",
    summary:
      "package.json already has a postinstall script, so init left it alone.",
    nextActions: [APPEND_ADVICE],
  };
}

function skillsSyncFailedDiagnostic(cause: unknown): Diagnostic {
  return {
    code: "INIT.SKILLS_SYNC_FAILED",
    severity: "warn",
    summary: `The agent skills could not be synced: ${cause instanceof Error ? cause.message : String(cause)}`,
    nextActions: [
      {
        kind: "run-command",
        label: "Retry the sync on its own",
        command: `${CLI_NAME} skills sync`,
      },
    ],
  };
}

const FIRST_INDENT = /\n([ \t]+)"/;

/** The indentation the file already uses, so the rewrite matches it. */
function detectIndent(source: string): string {
  return FIRST_INDENT.exec(source)?.[1] ?? "  ";
}

async function addPostinstallHook(
  cwd: string,
): Promise<Step<InitPostinstallReport>> {
  const manifestPath = path.join(cwd, "package.json");

  let source: string;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch {
    return {
      report: { outcome: "skipped", script: null },
      line: summary("warn", "No package.json here; postinstall hook skipped."),
      diagnostics: [noPackageJsonDiagnostic()],
    };
  }

  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(source);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("package.json is not an object");
    }
    manifest = parsed as Record<string, unknown>;
  } catch {
    return {
      report: { outcome: "skipped", script: null },
      line: summary(
        "warn",
        "package.json could not be parsed; postinstall hook skipped.",
      ),
      diagnostics: [unreadablePackageJsonDiagnostic()],
    };
  }

  const scripts =
    typeof manifest.scripts === "object" &&
    manifest.scripts !== null &&
    !Array.isArray(manifest.scripts)
      ? (manifest.scripts as Record<string, unknown>)
      : {};
  const existing = scripts.postinstall;

  if (existing === POSTINSTALL_SCRIPT) {
    return {
      report: { outcome: "exists", script: POSTINSTALL_SCRIPT },
      line: summary("info", "The postinstall hook is already in package.json."),
      diagnostics: [],
    };
  }

  if (existing !== undefined) {
    return {
      report: {
        outcome: "kept",
        script: typeof existing === "string" ? existing : null,
      },
      line: summary(
        "warn",
        "package.json has its own postinstall script; left untouched.",
      ),
      diagnostics: [foreignPostinstallDiagnostic()],
    };
  }

  manifest.scripts = { ...scripts, postinstall: POSTINSTALL_SCRIPT };
  const rewritten = JSON.stringify(manifest, null, detectIndent(source));
  await writeFile(
    manifestPath,
    source.endsWith("\n") ? `${rewritten}\n` : rewritten,
    "utf8",
  );

  return {
    report: { outcome: "added", script: POSTINSTALL_SCRIPT },
    line: summary(
      "ok",
      `Added "postinstall": "${POSTINSTALL_SCRIPT}" to package.json.`,
    ),
    diagnostics: [],
  };
}

async function syncSkillsStep(
  cwd: string,
  checkEnabledByConfig: boolean,
): Promise<Step<InitSkillsReport>> {
  try {
    const outcome = await syncSkills(await readSkillsStatus(cwd));
    const result: SkillsSyncResult = {
      projectRoot: outcome.projectRoot,
      packages: packageReports(outcome.packages),
      synced: outcome.synced,
      pruned: outcome.pruned,
      refused: outcome.refused,
      checkDisabled: outcome.checkDisabled || !checkEnabledByConfig,
    };
    return {
      report: {
        outcome:
          result.synced.length > 0 || result.pruned.length > 0
            ? "synced"
            : "up-to-date",
        sync: result,
      },
      line: null,
      diagnostics: versionConflictDiagnostics(outcome.packages),
    };
  } catch (cause) {
    return {
      report: { outcome: "failed", sync: null },
      line: summary("warn", "The agent skills could not be synced."),
      diagnostics: [skillsSyncFailedDiagnostic(cause)],
    };
  }
}

const SKIPPED_POSTINSTALL: Step<InitPostinstallReport> = {
  report: { outcome: "skipped", script: null },
  line: summary("info", "Skipped the postinstall hook (--no-postinstall)."),
  diagnostics: [],
};

const SKIPPED_SKILLS: Step<InitSkillsReport> = {
  report: { outcome: "skipped", sync: null },
  line: summary("info", "Skipped the skills sync (--no-skills)."),
  diagnostics: [],
};

function initPresentations(
  result: InitResult,
  postinstall: Step<InitPostinstallReport>,
  skills: Step<InitSkillsReport>,
): Presentations {
  return {
    json: () => result,
    next: () => [],
    stdout: () => [],
    human: (ui) => {
      const skillsBlocks =
        result.skills.sync === null
          ? []
          : syncPresentations(result.skills.sync).human(ui);
      return [
        ...(postinstall.line === null ? [] : [postinstall.line]),
        ...(skills.line === null ? skillsBlocks : [skills.line]),
      ];
    },
  };
}

export const initCommand = defineCommand({
  help: {
    summary: "Prepare this repository for Prisma development",
    description:
      "Runs locally and calls no platform API. Adds a postinstall script to package.json that keeps the Prisma agent skills in sync on every install, then syncs the skills once now. Rerunning is safe: each step reports what is already done.",
    examples: ["init", "init --no-postinstall"],
  },
  needs: { config: skillsConfigSection },
  args: {
    flags: {
      postinstall: flag.optionalBoolean({
        brief: "Add the skills-sync postinstall hook (--no-postinstall skips)",
      }),
      skills: flag.optionalBoolean({
        brief: "Sync the agent skills now (--no-skills skips)",
      }),
    },
  },
  handler: async (args, ctx) => {
    const postinstall =
      args.flags.postinstall === false
        ? SKIPPED_POSTINSTALL
        : await addPostinstallHook(ctx.cwd);
    const skills =
      args.flags.skills === false
        ? SKIPPED_SKILLS
        : await syncSkillsStep(ctx.cwd, ctx.config.check);

    const result: InitResult = {
      postinstall: postinstall.report,
      skills: skills.report,
    };
    return ok(
      ctx.present(
        {
          data: result,
          diagnostics: [...postinstall.diagnostics, ...skills.diagnostics],
        },
        initPresentations(result, postinstall, skills),
      ),
    );
  },
});
