import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Block, Presentations } from "@prisma/cli-engine";
import { defineCommand, flag } from "@prisma/cli-engine";
import type { Diagnostic, NextAction } from "@prisma/cli-engine/protocol";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../cli-name";
import { resolveInstallCommandSync } from "../lib/agent/package-manager";
import {
  type AgentName,
  isKnownAgent,
  KNOWN_AGENTS,
} from "../lib/skills/allowlist";
import { readSkillsStatus } from "../lib/skills/status";
import { syncSkills } from "../lib/skills/sync";
import { getCliVersion } from "../lib/version";
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

export type InitDependencyOutcome = "added" | "declared" | "skipped";

export interface InitPostinstallReport {
  readonly outcome: InitPostinstallOutcome;
  /** The postinstall script package.json holds after init; null when
   *  the step was skipped or nothing was written. */
  readonly script: string | null;
  /** The prisma dev dependency: "declared" when any dependency field
   *  already names prisma, "skipped" when the manifest edit did not
   *  happen. */
  readonly dependency: InitDependencyOutcome;
}

/** "up-to-date" is reserved for a project that has skills installed and
 *  current; each way the sync had nothing to work on names itself.
 *  "no-agents": the config records `agents: []`. "no-packages": no
 *  allowlisted Prisma package is installed. "no-skills": packages are
 *  installed but their versions ship no skills. */
export type InitSkillsOutcome =
  | "synced"
  | "up-to-date"
  | "no-agents"
  | "no-packages"
  | "no-skills"
  | "failed"
  | "skipped";

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
  /** The step's human lines; null when the skills sync ran, whose
   *  outcome renders through the shared sync presentation instead. */
  readonly lines: readonly Block[] | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly next?: readonly NextAction[];
}

function summary(status: "ok" | "info" | "warn", text: string): Block {
  return { kind: "summary", status, text };
}

const APPEND_ADVICE = {
  kind: "user-choice" as const,
  label: `Append "${POSTINSTALL_SCRIPT}" to your postinstall script yourself to resync the skills on every install.`,
};

function addDependencyAdvice(version: string): NextAction {
  return {
    kind: "user-choice",
    label: `Add "prisma": "${version}" to devDependencies yourself, then run your package manager's install.`,
  };
}

function noPackageJsonDiagnostic(version: string): Diagnostic {
  return {
    code: "INIT.NO_PACKAGE_JSON",
    severity: "warn",
    summary:
      "There is no package.json in this directory, so the postinstall hook and the prisma dev dependency were not added.",
    nextActions: [
      {
        kind: "user-choice",
        label: `Run ${CLI_NAME} init from the directory that holds your package.json.`,
      },
      addDependencyAdvice(version),
    ],
  };
}

function unreadablePackageJsonDiagnostic(version: string): Diagnostic {
  return {
    code: "INIT.PACKAGE_JSON_UNREADABLE",
    severity: "warn",
    summary:
      "package.json could not be parsed, so the postinstall hook and the prisma dev dependency were not added.",
    nextActions: [APPEND_ADVICE, addDependencyAdvice(version)],
  };
}

function unwritablePackageJsonDiagnostic(
  hookNeeded: boolean,
  dependencyNeeded: boolean,
  version: string,
): Diagnostic {
  return {
    code: "INIT.PACKAGE_JSON_UNWRITABLE",
    severity: "warn",
    summary: "package.json could not be written, so init left it unchanged.",
    nextActions: [
      ...(hookNeeded ? [APPEND_ADVICE] : []),
      ...(dependencyNeeded ? [addDependencyAdvice(version)] : []),
    ],
  };
}

function scriptsNotAnObjectDiagnostic(
  dependencyNeeded: boolean,
  version: string,
): Diagnostic {
  return {
    code: "INIT.SCRIPTS_NOT_AN_OBJECT",
    severity: "warn",
    summary:
      "The scripts field in package.json is not an object, so init left it alone.",
    nextActions: [
      APPEND_ADVICE,
      ...(dependencyNeeded ? [addDependencyAdvice(version)] : []),
    ],
  };
}

function foreignPostinstallDiagnostic(
  dependencyNeeded: boolean,
  version: string,
): Diagnostic {
  return {
    code: "INIT.POSTINSTALL_KEPT",
    severity: "warn",
    summary:
      "package.json already has a postinstall script, so init left it alone.",
    nextActions: [
      APPEND_ADVICE,
      ...(dependencyNeeded ? [addDependencyAdvice(version)] : []),
    ],
  };
}

function devDependenciesNotAnObjectDiagnostic(version: string): Diagnostic {
  return {
    code: "INIT.DEV_DEPENDENCIES_NOT_AN_OBJECT",
    severity: "warn",
    summary:
      "The devDependencies field in package.json is not an object, so init did not add the prisma dev dependency.",
    nextActions: [
      {
        kind: "user-choice",
        label: `Fix the devDependencies field so it is an object, then add "prisma": "${version}" yourself and run your package manager's install.`,
      },
    ],
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

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** A declaration in any field, at any version or range, counts — init
 *  never second-guesses a version the user chose. */
function declaresPrisma(manifest: Record<string, unknown>): boolean {
  return DEPENDENCY_FIELDS.some((field) => {
    const value = manifest[field];
    return isPlainObject(value) && Object.hasOwn(value, "prisma");
  });
}

async function addPostinstallHook(
  cwd: string,
): Promise<Step<InitPostinstallReport>> {
  const manifestPath = path.join(cwd, "package.json");
  const version = getCliVersion();

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return {
      report: { outcome: "skipped", script: null, dependency: "skipped" },
      lines: [
        summary("warn", "No package.json here; postinstall hook skipped."),
      ],
      diagnostics: [noPackageJsonDiagnostic(version)],
    };
  }

  const bom = raw.startsWith(BOM) ? BOM : "";
  const source = bom === "" ? raw : raw.slice(BOM.length);
  const crlf = source.includes("\r\n");

  const manifest = parseManifestObject(source);
  if (manifest === null) {
    return {
      report: { outcome: "skipped", script: null, dependency: "skipped" },
      lines: [
        summary(
          "warn",
          "package.json could not be parsed; postinstall hook skipped.",
        ),
      ],
      diagnostics: [unreadablePackageJsonDiagnostic(version)],
    };
  }

  const dependencyDeclared = declaresPrisma(manifest);
  // A manifest init keeps its hands off also gets no dependency added.
  const keptDependency: InitDependencyOutcome = dependencyDeclared
    ? "declared"
    : "skipped";

  if (manifest.scripts !== undefined && !isPlainObject(manifest.scripts)) {
    return {
      report: { outcome: "kept", script: null, dependency: keptDependency },
      lines: [
        summary(
          "warn",
          "The scripts field in package.json is not an object; left untouched.",
        ),
      ],
      diagnostics: [scriptsNotAnObjectDiagnostic(!dependencyDeclared, version)],
    };
  }

  const scripts = (manifest.scripts as Record<string, unknown>) ?? {};
  const existing = scripts.postinstall;

  if (existing !== undefined && existing !== POSTINSTALL_SCRIPT) {
    return {
      report: {
        outcome: "kept",
        script: typeof existing === "string" ? existing : null,
        dependency: keptDependency,
      },
      lines: [
        summary(
          "warn",
          "package.json has its own postinstall script; left untouched.",
        ),
      ],
      diagnostics: [foreignPostinstallDiagnostic(!dependencyDeclared, version)],
    };
  }

  return writeHookAndDependency({
    cwd,
    manifestPath,
    manifest,
    scripts,
    source,
    bom,
    crlf,
    hookNeeded: existing === undefined,
    dependencyNeeded: !dependencyDeclared,
  });
}

async function writeHookAndDependency(edit: {
  cwd: string;
  manifestPath: string;
  manifest: Record<string, unknown>;
  scripts: Record<string, unknown>;
  source: string;
  bom: string;
  crlf: boolean;
  hookNeeded: boolean;
  dependencyNeeded: boolean;
}): Promise<Step<InitPostinstallReport>> {
  const { manifest, hookNeeded, dependencyNeeded } = edit;
  const version = getCliVersion();

  // A devDependencies value that is not an object stays untouched, the
  // same way a malformed scripts field does; only the hook edit (whose
  // field is fine) may proceed.
  const dependencyBlocked =
    dependencyNeeded &&
    manifest.devDependencies !== undefined &&
    !isPlainObject(manifest.devDependencies);
  const block = dependencyBlock(dependencyBlocked, version);
  const dependencyEdit = dependencyNeeded && !dependencyBlocked;

  if (!hookNeeded && !dependencyEdit) {
    return {
      report: {
        outcome: "exists",
        script: POSTINSTALL_SCRIPT,
        dependency: block.kept,
      },
      lines: [ALREADY_HOOKED, ...block.lines],
      diagnostics: block.diagnostics,
    };
  }

  if (hookNeeded) {
    manifest.scripts = { ...edit.scripts, postinstall: POSTINSTALL_SCRIPT };
  }
  if (dependencyEdit) {
    const devDependencies = isPlainObject(manifest.devDependencies)
      ? manifest.devDependencies
      : {};
    manifest.devDependencies = { ...devDependencies, prisma: version };
  }

  try {
    await writeFile(
      edit.manifestPath,
      renderManifest(manifest, edit.source, edit.bom, edit.crlf),
      "utf8",
    );
  } catch {
    return {
      report: {
        outcome: hookNeeded ? "skipped" : "exists",
        script: hookNeeded ? null : POSTINSTALL_SCRIPT,
        // A failed write skips only what the write would have added; a
        // dependency the manifest already declares stays declared.
        dependency: dependencyEdit ? "skipped" : block.kept,
      },
      lines: [
        summary("warn", "package.json could not be written; left unchanged."),
        ...block.lines,
      ],
      diagnostics: [
        unwritablePackageJsonDiagnostic(hookNeeded, dependencyEdit, version),
        ...block.diagnostics,
      ],
    };
  }

  return manifestEditedStep(edit, dependencyEdit, block, version);
}

const ALREADY_HOOKED: Block = {
  kind: "summary",
  status: "info",
  text: "The postinstall hook is already in package.json.",
};

/** What a blocked (non-object) devDependencies field contributes to
 *  every outcome: its warning line, its diagnostic, and the outcome the
 *  untouched dependency reports. */
function dependencyBlock(
  blocked: boolean,
  version: string,
): {
  lines: readonly Block[];
  diagnostics: readonly Diagnostic[];
  kept: InitDependencyOutcome;
} {
  if (!blocked) {
    return { lines: [], diagnostics: [], kept: "declared" };
  }
  return {
    lines: [
      summary(
        "warn",
        "The devDependencies field in package.json is not an object; prisma was not added.",
      ),
    ],
    diagnostics: [devDependenciesNotAnObjectDiagnostic(version)],
    kept: "skipped",
  };
}

/** Detection walks ancestor package.json and lockfiles, and runs after
 *  the manifest edit already landed — a directory it cannot read must
 *  not fail the init, and guessing npm would name the wrong manager, so
 *  the fallback advice names none. The same guard the post-login tip
 *  puts around this walk. */
function installAddedDependencyAction(cwd: string): NextAction {
  try {
    return {
      kind: "run-command",
      label: "Install the added prisma dev dependency",
      command: resolveInstallCommandSync(cwd),
    };
  } catch {
    return {
      kind: "user-choice",
      label:
        "Run your package manager's install to fetch the added prisma dev dependency.",
    };
  }
}

function manifestEditedStep(
  edit: { cwd: string; hookNeeded: boolean },
  dependencyEdit: boolean,
  block: {
    lines: readonly Block[];
    diagnostics: readonly Diagnostic[];
    kept: InitDependencyOutcome;
  },
  version: string,
): Step<InitPostinstallReport> {
  const { hookNeeded } = edit;
  return {
    report: {
      outcome: hookNeeded ? "added" : "exists",
      script: POSTINSTALL_SCRIPT,
      dependency: dependencyEdit ? "added" : block.kept,
    },
    lines: [
      hookNeeded
        ? summary(
            "ok",
            `Added "postinstall": "${POSTINSTALL_SCRIPT}" to package.json.`,
          )
        : ALREADY_HOOKED,
      ...(dependencyEdit
        ? [
            summary(
              "ok",
              `Added "prisma": "${version}" to devDependencies in package.json.`,
            ),
          ]
        : []),
      ...block.lines,
    ],
    next: dependencyEdit ? [installAddedDependencyAction(edit.cwd)] : [],
    diagnostics: block.diagnostics,
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
      lines: [
        agentsConfigured
          ? summary(
              "info",
              "prisma.config.ts already configures skills.agents.",
            )
          : summary("warn", "prisma.config.ts already exists; left untouched."),
      ],
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
      lines: [
        summary("warn", "prisma.config.ts could not be written; skipped."),
      ],
      diagnostics: [configUnwritableDiagnostic(agents)],
    };
  }

  return {
    report: { outcome: "created", agents },
    lines: [
      summary("ok", `Created prisma.config.ts with ${configSnippet(agents)}.`),
    ],
    diagnostics: [],
  };
}

function skillsOutcome(result: SkillsSyncResult): InitSkillsOutcome {
  if (result.synced.length > 0 || result.pruned.length > 0) {
    return "synced";
  }
  if (result.agents.length === 0) {
    return "no-agents";
  }
  if (result.packages.length === 0) {
    return "no-packages";
  }
  if (result.skills.length === 0) {
    return "no-skills";
  }
  return "up-to-date";
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
      skills: outcome.skills,
      synced: outcome.synced,
      pruned: outcome.pruned,
      refused: outcome.refused,
      checkDisabled: outcome.checkDisabled || !checkEnabledByConfig,
    };
    return {
      report: {
        outcome: skillsOutcome(result),
        sync: result,
      },
      lines: null,
      diagnostics: [
        ...versionConflictDiagnostics(outcome.packages),
        ...unmanagedDirectoryDiagnostics(outcome.refused),
      ],
    };
  } catch (cause) {
    return {
      report: { outcome: "failed", sync: null },
      lines: [summary("warn", "The agent skills could not be synced.")],
      diagnostics: [skillsSyncFailedDiagnostic(cause)],
    };
  }
}

const SKIPPED_POSTINSTALL: Step<InitPostinstallReport> = {
  report: { outcome: "skipped", script: null, dependency: "skipped" },
  lines: [summary("info", "Skipped the postinstall hook (--no-postinstall).")],
  diagnostics: [],
};

const SKIPPED_SKILLS: Step<InitSkillsReport> = {
  report: { outcome: "skipped", sync: null },
  lines: [summary("info", "Skipped the skills sync (--skills=none).")],
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
    next: () => postinstall.next ?? [],
    stdout: () => [],
    human: (ui) => {
      const skillsBlocks =
        result.skills.sync === null
          ? []
          : syncPresentations(result.skills.sync).human(ui);
      return [
        ...(postinstall.lines ?? []),
        ...(config.lines ?? []),
        ...(skills.lines ?? skillsBlocks),
      ];
    },
  };
}

export const initCommand = defineCommand({
  help: {
    summary:
      "Prepare this repository for Prisma: config file, dev dependency, AI-agent skills",
    description:
      "Runs locally and calls no platform API. Adds a postinstall script to package.json that keeps the Prisma agent skills in sync on every install, adds prisma to devDependencies at this CLI's exact version when no dependency field declares it, scaffolds a prisma.config.ts recording which agents to install skills for, then syncs the skills once now. Everything lands in the current directory; a prisma.config.ts or postinstall script that already exists is never edited. Rerunning is safe: each step reports what is already done.",
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
