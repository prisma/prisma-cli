/**
 * The staleness check every command runs. Skills are copies of files
 * that ship inside the Prisma packages a project installs, so they go
 * out of date whenever those packages move and nothing re-copies them.
 * The project's postinstall normally does; this catches every way that
 * can be bypassed, by naming the mismatch once on stderr.
 *
 * It never changes the exit code, never writes to stdout, and is not
 * conditioned on a TTY: agents run without one and are who this is for.
 */
import { loadConfig } from "@prisma/cli-engine";
import { skillsConfigSection } from "./commands/skills/config";
import { readSkillsCheckDisabled } from "./lib/skills/opt-out";
import { findProjectRoot } from "./lib/skills/project-root";
import {
  firstOutdatedSkill,
  readSkillsStatus,
  type SkillsStatus,
} from "./lib/skills/status";
import { getCliName } from "./lib/version";

export interface SkillsCheckRuntime {
  readonly env: NodeJS.ProcessEnv;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly stderr: { write(text: string): unknown };
}

export const SKILLS_CHECK_ENV_VAR = "PRISMA_SKILLS_CHECK";

export async function maybeWriteSkillsStaleNotice(
  runtime: SkillsCheckRuntime,
): Promise<void> {
  if (isSuppressedByInvocation(runtime)) {
    return;
  }

  try {
    // The persisted opt-out is one small file; reading it first spares
    // an opted-out project the package and directory scans, and the
    // notice never reads the orphan list.
    const projectRoot = await findProjectRoot(runtime.cwd);
    if (await readSkillsCheckDisabled(projectRoot)) {
      return;
    }
    const status = await readSkillsStatus(runtime.cwd, { orphans: false });
    if (status.upToDate) {
      return;
    }
    if (await isDisabledInConfig(runtime)) {
      return;
    }
    const notice = renderStaleNotice(status);
    if (notice !== null) {
      runtime.stderr.write(notice);
    }
  } catch {
    // The check is advisory: a project it cannot read is not a failure
    // of the command the user actually ran.
    return;
  }
}

export function renderStaleNotice(status: SkillsStatus): string | null {
  const outdated = firstOutdatedSkill(status);
  if (outdated === null) {
    return null;
  }

  const synced = outdated.targets.find(
    (target) => target.state === "stale",
  )?.syncedVersion;
  return (
    `Prisma agent skills are out of date (installed ${outdated.library} ` +
    `${outdated.version}, synced ${synced ?? "none"}). ` +
    `Run: ${getCliName()} skills sync\n`
  );
}

/** The shared flags that take a separate value, so the word after them
 *  is that value rather than the command being invoked. */
const FLAGS_TAKING_A_VALUE = new Set([
  "--format",
  "--log-level",
  "--config",
  "--confirm",
]);

/** The first word of the invocation — the group, or the command when it
 *  is mounted top-level — skipping the shared flags that may precede it. */
function invokedGroup(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (!token.startsWith("-")) {
      return token;
    }
    if (FLAGS_TAKING_A_VALUE.has(token)) {
      index += 1;
    }
  }
  return undefined;
}

/** Tokens before a bare `--`; everything after it is positional data,
 *  never a flag. */
function flagTokens(argv: readonly string[]): readonly string[] {
  const end = argv.indexOf("--");
  return end === -1 ? argv : argv.slice(0, end);
}

/** The off switches that cost nothing to read. */
function isSuppressedByInvocation(runtime: SkillsCheckRuntime): boolean {
  const env = runtime.env;
  if (env[SKILLS_CHECK_ENV_VAR] === "0") {
    return true;
  }
  if (env.CI || env.GITHUB_ACTIONS) {
    return true;
  }

  const argv = flagTokens(runtime.argv);
  // The command that fixes this must not also complain about it.
  if (invokedGroup(argv) === "skills") {
    return true;
  }
  if (
    argv.includes("--json") ||
    argv.includes("--quiet") ||
    argv.includes("-q")
  ) {
    return true;
  }
  // The same exemption the update check applies.
  if (argv.includes("--version")) {
    return true;
  }
  return argv.some(
    (token, index) =>
      token === "--format=json" ||
      (token === "--format" && argv[index + 1] === "json"),
  );
}

/** The file an explicit --config names, so the check reads the same
 *  config the command did. Discovery is otherwise cwd-only. */
function configPathFromArgv(argv: readonly string[]): string | undefined {
  const tokens = flagTokens(argv);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token === "--config") {
      return tokens[index + 1];
    }
    if (token.startsWith("--config=")) {
      return token.slice("--config=".length);
    }
  }
  return undefined;
}

/**
 * `skills: { check: false }` in prisma.config.ts. Read last and only
 * when the project is already known to be out of date, because
 * evaluating that file costs a TypeScript transpile — far more than
 * everything else the check does.
 */
async function isDisabledInConfig(
  runtime: SkillsCheckRuntime,
): Promise<boolean> {
  const loaded = await loadConfig(
    runtime.cwd,
    configPathFromArgv(runtime.argv),
  );
  const section = skillsConfigSection.validate(
    loaded.sections[skillsConfigSection.name],
  );
  return section.ok && !section.value.check;
}
