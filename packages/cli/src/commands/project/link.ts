/** The `project link` command. */
import { defineCommand, positional } from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { formatCommandArgument } from "../../command-arguments";
import { createAppProvider } from "../../lib/app/app-provider";
import {
  inferTargetName,
  type ProjectCandidate,
  sortProjects,
} from "../../lib/project/resolution";
import {
  isValidProjectSetupName,
  projectCreateFailedError,
  projectSetupNameRequiredError,
  resolveProjectForSetup,
  toProjectSummary,
} from "../../lib/project/setup";
import type { AuthWorkspace } from "../../types/auth";
import type { ProjectSetupResult, ProjectSummary } from "../../types/project";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import {
  bindDirectoryToProject,
  listWorkspaceProjects,
  type ProjectCommandContext,
} from "./context";
import { setupPresentations } from "./presentation";

const CREATE_CHOICE = "__create__";
const CANCEL_CHOICE = "__cancel__";

function setupCanceledError(): CliStructuredError {
  return new CliStructuredError(
    "PROJECT.USAGE_ERROR",
    "Project setup canceled",
    {
      why: "Project link needs a Project before it can continue.",
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Choose an existing Project or create a new one, then rerun project link.",
        },
        {
          kind: "run-command",
          label: "prisma project link <id-or-name>",
          command: "prisma project link <id-or-name>",
        },
        {
          kind: "run-command",
          label: "prisma project create <name>",
          command: "prisma project create <name>",
        },
      ],
    },
  );
}

function choiceOptions(
  projects: ProjectCandidate[],
): Array<{ value: string; label: string }> {
  const sorted = sortProjects(projects);
  const duplicated = new Set(
    sorted
      .map((project) => project.name)
      .filter((name, index, names) => names.indexOf(name) !== index),
  );

  return [
    { value: CREATE_CHOICE, label: "+ Create a new Project" },
    ...sorted.map((project) => ({
      value: project.id,
      label: duplicated.has(project.name)
        ? `${project.name} (${project.id})`
        : project.name,
    })),
    { value: CANCEL_CHOICE, label: "Cancel" },
  ];
}

async function createProjectForLink(
  ctx: ProjectCommandContext,
  workspace: AuthWorkspace,
  projectName: string,
): Promise<ProjectSummary> {
  const created = await createAppProvider(ctx.api)
    .createProject({ name: projectName, signal: ctx.signal })
    .catch((error: unknown) => {
      /** A cancelled run is cancelled, not a failed creation. The
       *  provider flattens the underlying AbortError into a plain
       *  Error, which the engine would settle as a bug, so hand it
       *  back its own abort reason and let it settle the run as
       *  cancelled. */
      if (ctx.signal.aborted) {
        throw ctx.signal.reason;
      }
      throw projectCreateFailedError(error, projectName, workspace, {
        nextSteps: [
          "prisma project list",
          "prisma project link <id-or-name>",
          `prisma project create ${formatCommandArgument(projectName)}`,
        ],
        permissionFix:
          "Grant the token permission to create Projects in this workspace, or link an existing Project.",
        fallbackFix:
          "Retry the command, or choose an existing Project with prisma project link <id-or-name>.",
      });
    });

  return { id: created.id, name: created.name };
}

async function pickProject(
  ctx: ProjectCommandContext,
  workspace: AuthWorkspace,
  projects: ProjectCandidate[],
): Promise<ProjectSetupResult> {
  const choice = await ctx.prompt.select(
    "Which Project should this directory use?",
    choiceOptions(projects),
  );

  if (choice === CANCEL_CHOICE) {
    throw setupCanceledError();
  }

  if (choice === CREATE_CHOICE) {
    const suggested = await inferTargetName(ctx.cwd, ctx.signal);
    const name = await ctx.prompt.text("Project name", {
      placeholder: suggested.name,
      default: suggested.name,
    });
    // The same rule `project create` applies to its positional: a name
    // typed at the prompt is no more valid for being typed.
    if (!isValidProjectSetupName(name)) {
      throw projectSetupNameRequiredError("project link");
    }
    const project = await createProjectForLink(ctx, workspace, name.trim());
    return await bindDirectoryToProject(ctx, workspace, project, "created");
  }

  const project = projects.find((candidate) => candidate.id === choice);
  if (!project) {
    throw setupCanceledError();
  }
  return await bindDirectoryToProject(
    ctx,
    workspace,
    toProjectSummary(project),
    "linked",
  );
}

/** The link itself, without the command around it: resolve the named
 *  Project or pick one, then bind `ctx.cwd` to it. */
async function linkDirectoryToProject(
  ctx: ProjectCommandContext,
  projectRef: string | undefined,
): Promise<ProjectSetupResult> {
  const workspace = await resolveActiveWorkspace(ctx);
  const projects = await listWorkspaceProjects(ctx);
  const ref = projectRef?.trim();

  return ref
    ? await bindDirectoryToProject(
        ctx,
        workspace,
        toProjectSummary(resolveProjectForSetup(ref, projects, workspace)),
        "linked",
      )
    : await pickProject(ctx, workspace, projects);
}

export const projectLinkCommand = defineCommand({
  args: {
    positionals: {
      project: positional.optionalString({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary:
      "Link this directory to a Project: commands run here target it by default",
    description:
      "Records locally that this directory belongs to an existing Project, so later commands resolve it without --project. Linking itself changes local state only. Run without an argument to pick from your workspace's projects; that picker also offers creating a new Project, which does create one on the platform.",
    examples: [
      "project link",
      "project link proj_123",
      'project link "Acme Dashboard" --json',
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const result = await linkDirectoryToProject(ctx, args.positionals.project);

    return ok(ctx.present({ data: result }, setupPresentations(result)));
  },
});
