import type { ProjectSetupSuggestion, ProjectSummary } from "../../types/project";
import { usageError } from "../../shell/errors";
import { selectPrompt, textPrompt } from "../../shell/prompt";
import type { CommandContext } from "../../shell/runtime";
import { inferTargetName, sortProjects, type ProjectCandidate } from "./resolution";
import { toProjectSummary, validateProjectSetupNameText } from "./setup";

type InteractiveProjectSetupChoice =
  | { kind: "project"; project: ProjectCandidate }
  | { kind: "create" }
  | { kind: "cancel" };

export interface InteractiveProjectSetupResult {
  project: ProjectSummary;
  action: "linked" | "created";
  targetName: string;
  targetNameSource: "prompt" | ProjectSetupSuggestion["suggestedProjectNameSource"];
}

export async function promptForProjectSetupChoice(options: {
  context: CommandContext;
  projects: ProjectCandidate[];
  createProject: (projectName: string) => Promise<ProjectCandidate>;
  cancel: {
    why: string;
    fix: string;
    nextSteps: string[];
  };
}): Promise<InteractiveProjectSetupResult> {
  const sortedProjects = sortProjects(options.projects);
  const choice = await selectPrompt<InteractiveProjectSetupChoice>({
    input: options.context.runtime.stdin,
    output: options.context.runtime.stderr,
    message: "Which Project should this directory use?",
    choices: [
      ...sortedProjects.map((project) => ({
        label: project.name,
        value: { kind: "project" as const, project },
      })),
      { label: "Create a new Project", value: { kind: "create" as const } },
      { label: "Cancel", value: { kind: "cancel" as const } },
    ],
  });

  if (choice.kind === "cancel") {
    throw usageError(
      "Project setup canceled",
      options.cancel.why,
      options.cancel.fix,
      options.cancel.nextSteps,
      "project",
    );
  }

  if (choice.kind === "project") {
    return {
      project: toProjectSummary(choice.project),
      action: "linked",
      targetName: choice.project.name,
      targetNameSource: "prompt",
    };
  }

  const suggestedName = await inferTargetName(options.context.runtime.cwd);
  const rawName = await textPrompt({
    input: options.context.runtime.stdin,
    output: options.context.runtime.stderr,
    message: "Project name",
    placeholder: suggestedName.name,
    validate: (value) => validateProjectSetupNameText(value, suggestedName.name),
  });
  const projectName = rawName.trim() || suggestedName.name;
  const created = await options.createProject(projectName);

  return {
    project: toProjectSummary(created),
    action: "created",
    targetName: projectName,
    targetNameSource: rawName.trim() ? "prompt" : suggestedName.source,
  };
}
