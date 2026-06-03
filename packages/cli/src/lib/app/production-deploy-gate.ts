import { CliError } from "../../shell/errors";
import { confirmPrompt } from "../../shell/prompt";
import { canPrompt, type CommandContext } from "../../shell/runtime";
import type { BranchKind } from "../../types/branch";
import type { PreviewAppProvider, PreviewDeploymentRecord } from "./preview-provider";

export async function enforceProductionDeployGate(
  context: CommandContext,
  provider: Pick<PreviewAppProvider, "listDeployments">,
  options: {
    appId: string | undefined;
    appName: string;
    branchKind: BranchKind;
    prod: boolean;
  },
): Promise<void> {
  if (options.branchKind !== "production") {
    return;
  }

  if (!options.appId) {
    renderFirstProductionDeployLine(context, options.appName);
    return;
  }

  const deploymentsResult = await provider.listDeployments(options.appId).catch((error) => {
    throw productionDeployInspectionFailedError(error);
  });
  const currentLiveDeployment = resolveCurrentProductionDeployment(deploymentsResult);
  if (!currentLiveDeployment) {
    renderFirstProductionDeployLine(context, options.appName);
    return;
  }

  if (!options.prod) {
    throw productionDeployRequiresFlagError();
  }

  if (context.flags.yes) {
    renderProductionDeployYesLine(context);
    return;
  }

  if (!canPrompt(context)) {
    throw productionDeployConfirmationRequiredError(options.appName);
  }

  renderProductionDeployConfirmation(context, currentLiveDeployment);
  const confirmed = await confirmPrompt({
    input: context.runtime.stdin,
    output: context.output.stderr,
    message: "Deploy to production?",
    initialValue: false,
  });

  if (!confirmed) {
    throw productionDeployCancelledError();
  }
}

function resolveCurrentProductionDeployment(result: Awaited<ReturnType<PreviewAppProvider["listDeployments"]>>): PreviewDeploymentRecord | null {
  if (result.deployments.length === 0) {
    return null;
  }

  if (result.app.liveDeploymentId) {
    const live = result.deployments.find((deployment) => deployment.id === result.app.liveDeploymentId);
    if (live) {
      return live;
    }
  }

  return result.deployments.find((deployment) => deployment.live === true) ?? result.deployments[0] ?? null;
}

function renderFirstProductionDeployLine(context: CommandContext, appName: string): void {
  if (context.flags.json || context.flags.quiet) {
    return;
  }

  context.output.stderr.write(`First deploy of "${appName}" -- promoting to production.\n\n`);
}

function renderProductionDeployYesLine(context: CommandContext): void {
  if (context.flags.json || context.flags.quiet) {
    return;
  }

  context.output.stderr.write("Deploying to production (--prod --yes).\n\n");
}

function renderProductionDeployConfirmation(
  context: CommandContext,
  currentLiveDeployment: PreviewDeploymentRecord,
): void {
  if (context.flags.json || context.flags.quiet) {
    return;
  }

  const lines = [
    "This will deploy to production and replace the live deployment.",
    "",
    `  Current live:  ${currentLiveDeployment.id} deployed ${formatDeploymentAge(currentLiveDeployment.createdAt)}`,
    "  New deploy:    will be built from your local code",
    "",
  ];
  context.output.stderr.write(`${lines.join("\n")}\n`);
}

function formatDeploymentAge(createdAt: string): string {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return createdAt;
  }

  const elapsedMs = Math.max(0, Date.now() - createdAtMs);
  const units = [
    { label: "day", ms: 24 * 60 * 60 * 1000 },
    { label: "hour", ms: 60 * 60 * 1000 },
    { label: "minute", ms: 60 * 1000 },
  ];

  for (const unit of units) {
    if (elapsedMs >= unit.ms) {
      const value = Math.floor(elapsedMs / unit.ms);
      return `${value} ${unit.label}${value === 1 ? "" : "s"} ago`;
    }
  }

  return "less than a minute ago";
}

function productionDeployRequiresFlagError(): CliError {
  return new CliError({
    code: "PROD_DEPLOY_REQUIRES_FLAG",
    domain: "app",
    summary: "Production deploy requires --prod",
    why: "The resolved Branch is production and this App already has a production deployment.",
    fix: "Re-run with --prod, or deploy from a preview Branch.",
    exitCode: 2,
    nextActions: [
      {
        kind: "run-command",
        journey: "deploy-app",
        label: "Deploy to production",
        command: "prisma-cli app deploy --prod",
      },
      {
        kind: "run-command",
        journey: "deploy-app",
        label: "Create a preview branch",
        commands: ["git checkout -b <branch-name>", "prisma-cli app deploy"],
      },
    ],
    humanLines: [
      "This would deploy to production.",
      "",
      "Production deploys require explicit intent. Re-run with:",
      "",
      "  prisma app deploy --prod",
      "",
      "Or deploy a preview from a feature branch:",
      "",
      "  git checkout -b <branch-name>",
      "  prisma app deploy",
    ],
  });
}

function productionDeployConfirmationRequiredError(appName: string): CliError {
  return new CliError({
    code: "CONFIRMATION_REQUIRED",
    domain: "app",
    summary: "Production deploy requires confirmation in the current mode",
    why: "This command cannot prompt for production deploy confirmation in the current mode.",
    fix: `Pass --prod --yes to confirm deployment of "${appName}" to production.`,
    exitCode: 1,
    nextSteps: ["prisma-cli app deploy --prod --yes"],
    nextActions: [
      {
        kind: "run-command",
        journey: "deploy-app",
        label: "Deploy to production non-interactively",
        command: "prisma-cli app deploy --prod --yes",
      },
    ],
  });
}

function productionDeployCancelledError(): CliError {
  return new CliError({
    code: "CONFIRMATION_REQUIRED",
    domain: "app",
    summary: "Production deploy cancelled",
    why: null,
    fix: null,
    exitCode: 0,
    humanLines: ["Cancelled."],
  });
}

function productionDeployInspectionFailedError(error: unknown): CliError {
  return new CliError({
    code: "DEPLOY_FAILED",
    domain: "app",
    summary: "Failed to inspect production deployments",
    why: error instanceof Error ? error.message : String(error),
    fix: "Retry the command, or rerun with --trace for more detailed diagnostics.",
    debug: formatDebugDetails(error),
    exitCode: 1,
    nextSteps: ["prisma-cli app list-deploys"],
  });
}

function formatDebugDetails(error: unknown): string | null {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return typeof error === "string" ? error : null;
}
