/**
 * What a check reports. Shaped after the engine's own Diagnostic
 * (packages/cli-engine/src/protocol.ts): a machine-readable kind, a
 * one-line summary, and bulky evidence kept separate from it.
 */

export type CheckName =
  | "import-purity"
  | "validator-no-throw"
  | "tarball"
  | "release-pins";

export type FindingKind =
  /** Built output imports a package the manifest does not declare. */
  | "undeclared-import"
  /** The manifest declares a runtime dependency the output never imports. */
  | "unimported-dependency"
  /** A specifier the caller requires is absent — the check swept the wrong thing. */
  | "missing-required-specifier"
  /** Nothing was swept, so nothing was proved. */
  | "no-output"
  /** No subjects were supplied, so nothing was proved. */
  | "no-subjects"
  /** A config-section validator threw instead of returning findings. */
  | "validator-threw"
  /** A validator returned something that is not a SectionValidation. */
  | "validator-malformed"
  | "pack-failed"
  | "install-failed"
  | "bin-failed"
  /** The shell and a family it mounts disagree about the engine version. */
  | "engine-pin-mismatch"
  /** A release depends on a dev build. */
  | "dev-build-in-release";

/**
 * A recorded reason a finding does not fail the run. Suppressed findings
 * still print: an exception nobody can see is how a known problem
 * becomes a permanent one.
 */
export interface Suppression {
  readonly reason: string;
  readonly removeWhen: string;
}

export interface Finding {
  readonly kind: FindingKind;
  readonly check: CheckName;
  /** What the finding is about: a package name, a section name. */
  readonly subject: string;
  /** One line, no ANSI. */
  readonly summary: string;
  readonly where?: { readonly path?: string; readonly line?: number };
  /** Bulky evidence: installer output, a stack. */
  readonly detail?: string;
  readonly suppressedBy?: Suppression;
}

export interface Report {
  readonly findings: readonly Finding[];
  readonly subjectsChecked: number;
}

/**
 * Zero only when every finding carries a suppression. A suppressed
 * finding is a decision on the record, not a pass.
 */
export function exitCodeFor(report: Report): number {
  return report.findings.every((finding) => finding.suppressedBy !== undefined)
    ? 0
    : 1;
}

export function renderHuman(report: Report): string {
  if (report.findings.length === 0) {
    return `conformance: ${report.subjectsChecked} subject(s) checked, nothing to report\n`;
  }
  const lines = report.findings.map((finding) => {
    const place =
      finding.where?.path === undefined ? "" : ` (${finding.where.path})`;
    const head = `${finding.suppressedBy === undefined ? "✘" : "•"} [${finding.check}/${finding.kind}] ${finding.subject}: ${finding.summary}${place}`;
    const excused =
      finding.suppressedBy === undefined
        ? []
        : [
            `    allowed for now: ${finding.suppressedBy.reason}`,
            `    remove when: ${finding.suppressedBy.removeWhen}`,
          ];
    const evidence =
      finding.detail === undefined ? [] : [indent(finding.detail)];
    return [head, ...excused, ...evidence].join("\n");
  });
  const failing = report.findings.filter(
    (f) => f.suppressedBy === undefined,
  ).length;
  const excused = report.findings.length - failing;
  return `${lines.join("\n")}\n\n${failing} failing, ${excused} allowed, ${report.subjectsChecked} subject(s) checked\n`;
}

export function renderJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function indent(text: string): string {
  return text
    .trimEnd()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
