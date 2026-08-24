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
import { readProjectSkillsConfig } from "./commands/skills/config";
import { agentSkillDirs, DEFAULT_AGENTS } from "./lib/skills/allowlist";
import { readSkillsCheckDisabled } from "./lib/skills/opt-out";
import {
  readSkillsStatus,
  type SkillStatus,
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
    if (await readSkillsCheckDisabled(runtime.cwd)) {
      return;
    }
    // Read over every known agent's directory first: the configured
    // agents are always a subset of the known set, so a project that is
    // current across the full set is current for any config, and the
    // config file — a TypeScript transpile, far more than everything
    // else the check does — is evaluated at most once, and only when
    // the full set already reads as out of date.
    const status = await readSkillsStatus(runtime.cwd, {
      orphans: false,
      checkDisabled: false,
    });
    if (status.upToDate) {
      return;
    }
    const config = await readProjectSkillsConfig(
      runtime.cwd,
      configPathFromArgv(runtime.argv),
    );
    if (config !== null && !config.check) {
      return;
    }
    const dirs = agentSkillDirs(config?.agents ?? DEFAULT_AGENTS);
    const notice = renderStaleNotice(status, dirs);
    if (notice !== null) {
      runtime.stderr.write(notice);
    }
  } catch {
    // The check is advisory: a project it cannot read is not a failure
    // of the command the user actually ran.
    return;
  }
}

/** The first skill with a stale or never-synced copy in one of the
 *  configured directories — what the check names in its one line. */
function firstOutdatedSkillIn(
  status: SkillsStatus,
  dirs: readonly string[],
): SkillStatus | null {
  return (
    status.skills.find((skill) =>
      skill.targets.some(
        (target) =>
          dirs.includes(target.dir) &&
          (target.state === "stale" || target.state === "absent"),
      ),
    ) ?? null
  );
}

export function renderStaleNotice(
  status: SkillsStatus,
  dirs: readonly string[],
): string | null {
  const outdated = firstOutdatedSkillIn(status, dirs);
  if (outdated === null) {
    return null;
  }

  const synced = outdated.targets.find(
    (target) => dirs.includes(target.dir) && target.state === "stale",
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
  // The commands that fix this must not also complain about it: the
  // skills group, and init, whose run includes a sync.
  const group = invokedGroup(argv);
  if (group === "skills" || group === "init") {
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
