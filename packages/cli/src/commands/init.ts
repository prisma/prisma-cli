import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Block, Presentations } from "@prisma/cli-engine";
import { defineCommand, flag } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../cli-name";
import {
  type AgentName,
  isKnownAgent,
  KNOWN_AGENTS,
} from "../lib/skills/allowlist";
import { readSkillsStatus } from "../lib/skills/status";
import { syncSkills } from "../lib/skills/sync";
import { skillsConfigSection } from "./skills/config";
import { syncPresentations } from "./skills/presentation";
import type { SkillsSyncResult } from "./skills/results";
import {
  packageReports,
  unmanagedDirectoryDiagnostics,
  versionConflictDiagnostics,
} from "./skills/sync";

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

export type InitConfigOutcome = "created" | "exists" | "skipped";

export interface InitConfigReport {
  readonly outcome: InitConfigOutcome;
  /** The agents list the scaffold carries; null when nothing was
   *  written. */
  readonly agents: readonly AgentName[] | null;
}

export interface InitResult {
  readonly postinstall: InitPostinstallReport;
  readonly config: InitConfigReport;
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

function unwritablePackageJsonDiagnostic(): Diagnostic {
  return {
    code: "INIT.PACKAGE_JSON_UNWRITABLE",
    severity: "warn",
    summary:
      "package.json could not be written, so the postinstall hook was not added.",
    nextActions: [APPEND_ADVICE],
  };
}

function scriptsNotAnObjectDiagnostic(): Diagnostic {
  return {
    code: "INIT.SCRIPTS_NOT_AN_OBJECT",
    severity: "warn",
    summary:
      "The scripts field in package.json is not an object, so init left it alone.",
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

function configSnippet(agents: readonly AgentName[]): string {
  return `skills: { agents: [${agents.map((agent) => `"${agent}"`).join(", ")}] }`;
}

/** The same never-touch discipline as the postinstall step's
 *  foreign-script rule: a prisma.config.ts the user already has is
 *  theirs, and init only says what to add. */
function configKeptDiagnostic(agents: readonly AgentName[]): Diagnostic {
  return {
    code: "INIT.CONFIG_KEPT",
    severity: "warn",
    summary:
      "prisma.config.ts already exists, so init left it alone instead of writing the skills section.",
    nextActions: [
      {
        kind: "user-choice",
        label: `Add ${configSnippet(agents)} to the object passed to definePrismaConfig in prisma.config.ts.`,
      },
    ],
  };
}

function configUnwritableDiagnostic(agents: readonly AgentName[]): Diagnostic {
  return {
    code: "INIT.CONFIG_UNWRITABLE",
    severity: "warn",
    summary: "prisma.config.ts could not be written, so init skipped it.",
    nextActions: [
      {
        kind: "user-choice",
        label: `Create a prisma.config.ts whose definePrismaConfig call carries ${configSnippet(agents)}.`,
      },
    ],
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

const BOM = "\uFEFF";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifestObject(source: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(source);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function renderManifest(
  manifest: Record<string, unknown>,
  source: string,
  bom: string,
  crlf: boolean,
): string {
  let rewritten = JSON.stringify(manifest, null, detectIndent(source));
  if (crlf) {
    rewritten = rewritten.replaceAll("\n", "\r\n");
  }
  const eol = crlf ? "\r\n" : "\n";
  return `${bom}${rewritten}${source.endsWith("\n") ? eol : ""}`;
}

async function addPostinstallHook(
  cwd: string,
): Promise<Step<InitPostinstallReport>> {
  const manifestPath = path.join(cwd, "package.json");

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return {
      report: { outcome: "skipped", script: null },
      line: summary("warn", "No package.json here; postinstall hook skipped."),
      diagnostics: [noPackageJsonDiagnostic()],
    };
  }

  const bom = raw.startsWith(BOM) ? BOM : "";
  const source = bom === "" ? raw : raw.slice(BOM.length);
  const crlf = source.includes("\r\n");

  const manifest = parseManifestObject(source);
  if (manifest === null) {
    return {
      report: { outcome: "skipped", script: null },
      line: summary(
        "warn",
        "package.json could not be parsed; postinstall hook skipped.",
      ),
      diagnostics: [unreadablePackageJsonDiagnostic()],
    };
  }

  if (manifest.scripts !== undefined && !isPlainObject(manifest.scripts)) {
    return {
      report: { outcome: "kept", script: null },
      line: summary(
        "warn",
        "The scripts field in package.json is not an object; left untouched.",
      ),
      diagnostics: [scriptsNotAnObjectDiagnostic()],
    };
  }

  const scripts = (manifest.scripts as Record<string, unknown>) ?? {};
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
  try {
    await writeFile(
      manifestPath,
      renderManifest(manifest, source, bom, crlf),
      "utf8",
    );
  } catch {
    return {
      report: { outcome: "skipped", script: null },
      line: summary(
        "warn",
        "package.json could not be written; postinstall hook skipped.",
      ),
      diagnostics: [unwritablePackageJsonDiagnostic()],
    };
  }

  return {
    report: { outcome: "added", script: POSTINSTALL_SCRIPT },
    line: summary(
      "ok",
      `Added "postinstall": "${POSTINSTALL_SCRIPT}" to package.json.`,
    ),
    diagnostics: [],
  };
}

/** What the scaffold contains: the effective agents list, spelled the
 *  way a user would write it by hand. */
export function renderConfigScaffold(agents: readonly AgentName[]): string {
  return [
    'import { definePrismaConfig } from "prisma/config";',
    "",
    "export default definePrismaConfig({",
    "  skills: {",
    `    agents: [${agents.map((agent) => `"${agent}"`).join(", ")}],`,
    "  },",
    "});",
    "",
  ].join("\n");
}

async function scaffoldConfigStep(
  cwd: string,
  agents: readonly AgentName[],
  agentsConfigured: boolean,
): Promise<Step<InitConfigReport>> {
  const configPath = path.join(cwd, "prisma.config.ts");

  let existing: string | null = null;
  try {
    existing = await readFile(configPath, "utf8");
  } catch {
    existing = null;
  }
  if (existing !== null) {
    // A config that already sets skills.agents — the engine evaluated
    // it, so this is the file's meaning, not a text match — needs no
    // advice; a rerun after init's own scaffold stays clean. Anything
    // else gets the exact snippet to add, and the file itself is never
    // edited.
    return {
      report: { outcome: "exists", agents: null },
      line: agentsConfigured
        ? summary("info", "prisma.config.ts already configures skills.agents.")
        : summary("warn", "prisma.config.ts already exists; left untouched."),
      diagnostics: agentsConfigured ? [] : [configKeptDiagnostic(agents)],
    };
  }

  try {
    // `flag: "wx"` so a file that appears between the check and the
    // write is still never overwritten.
    await writeFile(configPath, renderConfigScaffold(agents), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch {
    return {
      report: { outcome: "skipped", agents: null },
      line: summary("warn", "prisma.config.ts could not be written; skipped."),
      diagnostics: [configUnwritableDiagnostic(agents)],
    };
  }

  return {
    report: { outcome: "created", agents },
    line: summary(
      "ok",
      `Created prisma.config.ts with ${configSnippet(agents)}.`,
    ),
    diagnostics: [],
  };
}

async function syncSkillsStep(
  cwd: string,
  agents: readonly AgentName[],
  checkEnabledByConfig: boolean,
): Promise<Step<InitSkillsReport>> {
  try {
    const outcome = await syncSkills(await readSkillsStatus(cwd, { agents }));
    const result: SkillsSyncResult = {
      projectRoot: outcome.projectRoot,
      agents,
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
      diagnostics: [
        ...versionConflictDiagnostics(outcome.packages),
        ...unmanagedDirectoryDiagnostics(outcome.refused),
      ],
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
  line: summary("info", "Skipped the skills sync (--skills=none)."),
  diagnostics: [],
};

const SKIP_SENTINEL = "none";

function invalidSkillsFlagError(problem: string): CliStructuredError {
  return new CliStructuredError("CLI.INVALID_ARGUMENTS", problem, {
    nextActions: [
      {
        kind: "user-choice",
        label: `Pass --skills a comma-separated list of agents (${KNOWN_AGENTS.join(", ")}), or --skills=${SKIP_SENTINEL} to record that no agent skills are wanted.`,
      },
    ],
  });
}

/** `--skills`: absent defers to the config's agents (every known agent
 *  when there is no config); `none` records the choice — the scaffold
 *  gets `agents: []` and the sync is skipped; otherwise a
 *  comma-separated list of agent names. */
function parseSkillsFlag(
  raw: string | undefined,
  configured: readonly AgentName[],
):
  | { kind: "agents"; agents: readonly AgentName[] }
  | { kind: "skip" }
  | { kind: "invalid"; error: CliStructuredError } {
  if (raw === undefined) {
    return { kind: "agents", agents: configured };
  }
  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  if (names.includes(SKIP_SENTINEL)) {
    return names.length === 1
      ? { kind: "skip" }
      : {
          kind: "invalid",
          error: invalidSkillsFlagError(
            `--skills=${SKIP_SENTINEL} records that no agent skills are wanted, so it cannot be combined with agent names.`,
          ),
        };
  }
  const agents: AgentName[] = [];
  for (const name of names) {
    if (!isKnownAgent(name)) {
      return {
        kind: "invalid",
        error: invalidSkillsFlagError(
          `--skills names '${name}', which this CLI does not know. The known agents are ${KNOWN_AGENTS.join(", ")}.`,
        ),
      };
    }
    if (!agents.includes(name)) {
      agents.push(name);
    }
  }
  if (agents.length === 0) {
    return {
      kind: "invalid",
      error: invalidSkillsFlagError("--skills was given no agent names."),
    };
  }
  return { kind: "agents", agents };
}

function initPresentations(
  result: InitResult,
  postinstall: Step<InitPostinstallReport>,
  config: Step<InitConfigReport>,
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
        ...(config.line === null ? [] : [config.line]),
        ...(skills.line === null ? skillsBlocks : [skills.line]),
      ];
    },
  };
}

export const initCommand = defineCommand({
  help: {
    summary: "Prepare this repository for Prisma development",
    description:
      "Runs locally and calls no platform API. Adds a postinstall script to package.json that keeps the Prisma agent skills in sync on every install, scaffolds a prisma.config.ts recording which agents to install skills for, then syncs the skills once now. Everything lands in the current directory; a prisma.config.ts or postinstall script that already exists is never edited. Rerunning is safe: each step reports what is already done.",
    examples: [
      "init",
      "init --skills=claude,cursor",
      "init --skills=none",
      "init --no-postinstall",
    ],
  },
  needs: { config: skillsConfigSection },
  args: {
    flags: {
      postinstall: flag.optionalBoolean({
        brief: "Add the skills-sync postinstall hook (--no-postinstall skips)",
      }),
      skills: flag.string({
        brief: `Agents to install skills for (comma-separated: ${KNOWN_AGENTS.join(", ")}); '${SKIP_SENTINEL}' records that no agent skills are wanted`,
        placeholder: "agents",
      }),
    },
  },
  handler: async (args, ctx) => {
    const skillsFlag = parseSkillsFlag(args.flags.skills, ctx.config.agents);
    if (skillsFlag.kind === "invalid") {
      return notOk(skillsFlag.error);
    }

    const postinstall =
      args.flags.postinstall === false
        ? SKIPPED_POSTINSTALL
        : await addPostinstallHook(ctx.cwd);
    // --skills=none still scaffolds: `agents: []` is the committed
    // record that no agent skills are wanted, so later syncs and the
    // staleness check stay quiet instead of falling back to the
    // default agent set.
    const config = await scaffoldConfigStep(
      ctx.cwd,
      skillsFlag.kind === "skip" ? [] : skillsFlag.agents,
      ctx.config.agentsConfigured,
    );
    const skills =
      skillsFlag.kind === "skip"
        ? SKIPPED_SKILLS
        : await syncSkillsStep(ctx.cwd, skillsFlag.agents, ctx.config.check);

    const result: InitResult = {
      postinstall: postinstall.report,
      config: config.report,
      skills: skills.report,
    };
    return ok(
      ctx.present(
        {
          data: result,
          diagnostics: [
            ...postinstall.diagnostics,
            ...config.diagnostics,
            ...skills.diagnostics,
          ],
        },
        initPresentations(result, postinstall, config, skills),
      ),
    );
  },
});
