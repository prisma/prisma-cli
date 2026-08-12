/**
 * Offers to install `@prisma/compute-sdk` as a devDependency so the
 * generated config's typed import resolves in the editor. Deploy
 * resolves the import without a local install, so every outcome short
 * of success is a hint, never a failure.
 */
import { execa } from "execa";
import {
  type AgentPackageManager,
  detectPackageManagerSync,
} from "../../lib/agent/package-manager";
import { readBunPackageJson } from "../../lib/app/bun-project";
import { COMPUTE_SDK_PACKAGE } from "./settings";
import type { InitFlags, InitStepContext, InitTypesState } from "./types";

function packageAddCommand(packageManager: AgentPackageManager): string[] {
  switch (packageManager) {
    case "pnpm":
      return ["pnpm", "add", "-D", COMPUTE_SDK_PACKAGE];
    case "bun":
      return ["bun", "add", "-d", COMPUTE_SDK_PACKAGE];
    case "yarn":
      return ["yarn", "add", "-D", COMPUTE_SDK_PACKAGE];
    case "npm":
      return ["npm", "install", "-D", COMPUTE_SDK_PACKAGE];
  }
}

function hasComputeSdkDependency(
  packageJson: Awaited<ReturnType<typeof readBunPackageJson>>,
): boolean {
  for (const group of [
    packageJson?.dependencies,
    packageJson?.devDependencies,
  ]) {
    if (
      group &&
      typeof group === "object" &&
      COMPUTE_SDK_PACKAGE in (group as Record<string, unknown>)
    ) {
      return true;
    }
  }
  return false;
}

/** Test hook: JSON array command that replaces the real package-manager install. */
function installCommandOverride(step: InitStepContext): string[] | null {
  const raw = step.engine.env.PRISMA_CLI_INIT_INSTALL_COMMAND;
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((p) => typeof p === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function resolveTypes(
  flags: InitFlags,
  step: InitStepContext,
): Promise<InitTypesState> {
  const ctx = step.engine;
  // This step runs after the config is written; an unreadable
  // package.json (malformed JSON, permissions) must not turn the already
  // successful write into a command failure, so it degrades to a skip.
  let packageJson: Awaited<ReturnType<typeof readBunPackageJson>>;
  try {
    packageJson = await readBunPackageJson(ctx.cwd, ctx.signal);
  } catch (error) {
    ctx.signal.throwIfAborted();
    step.record({
      code: "INIT.TYPES_PACKAGE_JSON_UNREADABLE",
      severity: "warn",
      summary: `Skipped the ${COMPUTE_SDK_PACKAGE} types install: package.json could not be read (${firstLine(error)}).`,
      nextActions: [],
    });
    return skippedTypes();
  }

  if (hasComputeSdkDependency(packageJson)) {
    return {
      status: "already-installed",
      package: COMPUTE_SDK_PACKAGE,
      installCommand: null,
    };
  }

  const installCommand = packageAddCommand(
    detectPackageManagerSync(ctx.cwd) ?? "npm",
  );
  const installCommandText = installCommand.join(" ");
  const state = (status: InitTypesState["status"]): InitTypesState => ({
    status,
    package: COMPUTE_SDK_PACKAGE,
    installCommand: installCommandText,
  });

  // A directory without a package.json has nowhere to record the dependency.
  if (!packageJson || flags.install === false) {
    return state("skipped");
  }

  const shouldInstall =
    flags.install === true ||
    (await ctx.prompt.confirm(
      `Install ${COMPUTE_SDK_PACKAGE} for config types? (${installCommandText})`,
      { default: false },
    ));
  if (!shouldInstall) {
    return state("declined");
  }

  const command = installCommandOverride(step) ?? installCommand;
  try {
    const [executable, ...args] = command;
    await execa(executable as string, args, {
      cwd: ctx.cwd,
      env: ctx.env,
      cancelSignal: ctx.signal,
      stdin: "ignore",
    });
    return state("installed");
  } catch (error) {
    ctx.signal.throwIfAborted();
    step.record({
      code: "INIT.TYPES_INSTALL_FAILED",
      severity: "warn",
      summary: `Installing ${COMPUTE_SDK_PACKAGE} failed: ${firstLine(error)}. Install it later with ${installCommandText}.`,
      nextActions: [
        {
          kind: "run-command",
          label: installCommandText,
          command: installCommandText,
        },
      ],
    });
    return state("failed");
  }
}

/** execa's first message line is the short "Command failed" summary; the
 *  full package-manager output stays out of the warning. */
function firstLine(error: unknown): string {
  return error instanceof Error
    ? (error.message.split("\n")[0] as string)
    : String(error);
}

/** The JSON format is dependency-free by design, so its types step
 *  never runs and offers no install hint. */
export function skippedTypes(): InitTypesState {
  return {
    status: "skipped",
    package: COMPUTE_SDK_PACKAGE,
    installCommand: null,
  };
}
