import { padDisplay, type ShellUi } from "../../shell/ui";

export interface DeployOutputRow {
  label: string;
  value?: string;
  origin?: string;
}

const DEPLOY_OUTPUT_MIN_LABEL_WIDTH = "Framework".length;
const DEPLOY_OUTPUT_MIN_VALUE_WIDTH = "HTTP 3000".length;

export function renderDeployOutputRows(ui: ShellUi, rows: DeployOutputRow[]): string[] {
  if (rows.length === 0) {
    return [];
  }

  const labelWidth = Math.max(DEPLOY_OUTPUT_MIN_LABEL_WIDTH, ...rows.map((row) => row.label.length));
  const valueWidth = Math.max(DEPLOY_OUTPUT_MIN_VALUE_WIDTH, ...rows.map((row) => row.value?.length ?? 0));

  return rows.map((row) => {
    if (!row.value) {
      return `  ${row.label}`;
    }

    const label = padDisplay(row.label, labelWidth);
    const value = padDisplay(ui.strong(row.value), valueWidth);
    const origin = row.origin ? `  ${ui.dim(`· ${row.origin}`)}` : "";
    return `  ${label}  ${value}${origin}`.trimEnd();
  });
}
