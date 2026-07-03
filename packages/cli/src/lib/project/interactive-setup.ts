import { usageError } from "../../shell/errors";
import { selectPrompt, textPrompt } from "../../shell/prompt";
import type { CommandContext } from "../../shell/runtime";
import type {
  ProjectSetupSuggestion,
  ProjectSummary,
} from "../../types/project";
import {
  inferTargetName,
  type ProjectCandidate,
  sortProjects,
} from "./resolution";
import { toProjectSummary, validateProjectSetupNameText } from "./setup";

type InteractiveProjectSetupChoice =
  | { kind: "project"; project: ProjectCandidate }
  | { kind: "create" }
  | { kind: "cancel" };

export interface InteractiveProjectSetupResult {
  project: ProjectSummary;
  action: "linked" | "created";
  targetName: string;
  targetNameSource:
    | "prompt"
    | ProjectSetupSuggestion["suggestedProjectNameSource"];
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
  const projectNames = sortedProjects.map((project) => project.name);
  const duplicateNames = new Set(
    projectNames.filter((name, index) => projectNames.indexOf(name) !== index),
  );
  const choice = await selectPrompt<InteractiveProjectSetupChoice>({
    input: options.context.runtime.stdin,
    output: options.context.runtime.stderr,
    message: "Which Project should this directory use?",
    // "Create a new Project" stays first so it is reachable without paging
    // through a long project list; Cancel stays last by convention. The "+"
    // glyph highlights it without color, since the prompt library owns the
    // active-row styling and the style guide forbids color-only meaning.
    choices: [
      { label: "+ Create a new Project", value: { kind: "create" as const } },
      ...sortedProjects.map((project) => ({
        label: duplicateNames.has(project.name)
          ? `${project.name} (${project.id})`
          : project.name,
        value: { kind: "project" as const, project },
      })),
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

  const suggestedName = await inferTargetName(
    options.context.runtime.cwd,
    options.context.runtime.signal,
  );
  const rawName = await textPrompt({
    input: options.context.runtime.stdin,
    output: options.context.runtime.stderr,
    signal: options.context.runtime.signal,
    message: "Project name",
    placeholder: suggestedName.name,
    validate: (value) =>
      validateProjectSetupNameText(value, suggestedName.name),
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
