export type NextActionKind = "run-command" | "user-choice" | "edit-file" | "done";

export type NextActionJourney = "project-setup" | "deploy-app" | "inspect" | "recover";

export interface NextAction {
  kind: NextActionKind;
  journey: NextActionJourney;
  label: string;
  command?: string;
  commands?: string[];
  reason?: string;
}
