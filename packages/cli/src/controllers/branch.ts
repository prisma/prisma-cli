import { featureUnavailableError, usageError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import { canPrompt, type CommandContext } from "../shell/runtime";
import type { BranchShowResult, BranchListResult } from "../types/branch";
import { createCliUseCaseGateways } from "../use-cases/create-cli-gateways";
import { createBranchUseCases } from "../use-cases/branch";
import { createSelectPromptPort } from "./select-prompt-port";

const PREVIEW_BRANCH_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRealMode(context: CommandContext): boolean {
  return !context.runtime.fixturePath && !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH;
}

export async function runBranchList(context: CommandContext): Promise<CommandSuccess<BranchListResult>> {
  if (isRealMode(context)) {
    throw branchCommandsUnavailableError();
  }

  const useCases = createBranchUseCases(createCliUseCaseGateways(context));
  const result = await useCases.list();

  return {
    command: "branch.list",
    result,
    warnings: [],
    nextSteps: [],
  };
}

export async function runBranchShow(context: CommandContext): Promise<CommandSuccess<BranchShowResult>> {
  if (isRealMode(context)) {
    throw branchCommandsUnavailableError();
  }

  const useCases = createBranchUseCases(createCliUseCaseGateways(context));
  const result = await useCases.show();

  return {
    command: "branch.show",
    result,
    warnings: [],
    nextSteps:
      result.branch.kind === "preview" && !result.branch.remoteState ? ["prisma app deploy"] : [],
  };
}

export async function runBranchUse(
  context: CommandContext,
  branchName: string | undefined,
): Promise<CommandSuccess<BranchShowResult>> {
  if (isRealMode(context)) {
    throw branchCommandsUnavailableError();
  }

  const useCases = createBranchUseCases(createCliUseCaseGateways(context));
  const resolvedBranchName = await resolveBranchNameForUse(context, useCases, branchName);
  validateBranchName(resolvedBranchName);

  const result = await useCases.use(resolvedBranchName);
  const warnings = result.branch.kind === "production" ? ["Production is protected and durable. Use with care."] : [];

  return {
    command: "branch.use",
    result,
    warnings,
    nextSteps:
      result.branch.kind === "preview" && !result.branch.remoteState
        ? ["prisma branch show", "prisma app deploy"]
        : ["prisma branch show"],
  };
}

async function resolveBranchNameForUse(
  context: CommandContext,
  useCases: ReturnType<typeof createBranchUseCases>,
  branchName: string | undefined,
): Promise<string> {
  if (branchName) {
    return branchName;
  }

  if (!canPrompt(context)) {
    throw branchSelectionRequiredError();
  }

  const result = await useCases.list();
  const prompt = createSelectPromptPort(context);

  return prompt.select({
    message: "Select a branch",
    choices: result.branches.map((branch) => ({
      label: renderBranchChoiceLabel(branch),
      value: branch.name,
    })),
  });
}

function renderBranchChoiceLabel(branch: BranchListResult["branches"][number]): string {
  const markers = [];

  if (branch.active) {
    markers.push("active");
  }

  if (!branch.remoteState) {
    markers.push("not created yet");
  }

  return markers.length > 0 ? `${branch.name} (${markers.join(", ")})` : branch.name;
}

function validateBranchName(branchName: string): void {
  if (branchName === "production") {
    return;
  }

  if (PREVIEW_BRANCH_PATTERN.test(branchName)) {
    return;
  }

  throw usageError(
    "Branch name must use the documented form",
    "Branch names must be production or a lowercase preview slug such as preview or feat-auth.",
    "Use production or a lowercase preview branch name with letters, numbers, and hyphens.",
    ["prisma branch list"],
    "branch",
  );
}

function branchSelectionRequiredError() {
  return usageError(
    "Branch use requires a target in non-interactive mode",
    "This command cannot prompt for branch selection in the current mode.",
    "Re-run prisma branch use in a TTY, or pass a branch name explicitly.",
    ["prisma branch list"],
    "branch",
  );
}

function branchCommandsUnavailableError() {
  return featureUnavailableError(
    "Branch commands are not available in this preview",
    "The current preview cannot resolve or change remote branch context yet.",
    "Use prisma app deploy for preview app deployment workflows.",
    ["prisma app deploy --app <name>"],
    "branch",
  );
}
