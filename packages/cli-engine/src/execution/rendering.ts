import type { EngineEvent } from "../events";
import type { Block, PresentedResult } from "../presentation";
import type { Diagnostic, NextAction } from "../protocol";
import type { Invocation, RunState } from "./engine";

export function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return (newline === -1 ? text : text.slice(0, newline)).trim();
}

const STEP_OUTCOME_SYMBOL: Readonly<Record<string, string>> = {
  ok: "✔",
  failed: "✖",
  skipped: "↷",
  warning: "⚠",
};

/** Human rendering: `output` data lines are the command's data on OUR
 *  stdout; everything else is commentary on stderr. `remediation` is
 *  transcript-only: framed in json mode, never rendered in human mode,
 *  never aggregated into any envelope. */
export function renderEventHuman(
  invocation: Invocation,
  event: EngineEvent,
): void {
  const { stdout, stderr } = invocation.runtime;
  switch (event.kind) {
    case "message":
      stderr.write(`${event.text}\n`);
      return;
    case "output":
      (event.channel === "data" ? stdout : stderr).write(`${event.line}\n`);
      return;
    case "step-started":
      stderr.write(`▸ ${event.step}\n`);
      return;
    case "step-finished":
      stderr.write(`${STEP_OUTCOME_SYMBOL[event.outcome]} ${event.step}\n`);
      return;
    case "progress":
      stderr.write(
        `${event.step === undefined ? "progress" : event.step} ${event.completed}${event.total === undefined ? "" : `/${event.total}`}\n`,
      );
      return;
    case "remediation":
      return;
    case "endpoint":
      stderr.write(`${event.name}: ${event.url}\n`);
      return;
    case "status":
      stderr.write(
        `${event.subject}: ${event.from === undefined ? "" : `${event.from} → `}${event.status}\n`,
      );
      return;
    case "artifact":
      stderr.write(
        `${event.path}${event.description === undefined ? "" : ` — ${event.description}`}\n`,
      );
      return;
  }
}

const TONE_SYMBOL: Readonly<Record<string, string>> = {
  ok: "✔",
  error: "✖",
  warn: "⚠",
  info: "ℹ",
};

export function renderBlock(block: Block, write: (line: string) => void): void {
  switch (block.kind) {
    case "summary":
      write(`${TONE_SYMBOL[block.tone]} ${block.text}`);
      return;
    case "fields":
      for (const row of block.rows) {
        write(
          `${row.label}: ${row.sensitive === true ? "********" : row.value}`,
        );
      }
      return;
    case "table":
      write(block.columns.join("  "));
      for (const row of block.rows) {
        write(row.join("  "));
      }
      return;
    case "list":
      for (const item of block.items) {
        write(`- ${item}`);
      }
      return;
    case "tree":
      writeTree(block.roots, 0, write);
      return;
  }
}

function writeTree(
  nodes: ReadonlyArray<{
    readonly label: string;
    readonly children?: ReadonlyArray<{
      readonly label: string;
      readonly children?: readonly unknown[];
    }>;
  }>,
  depth: number,
  write: (line: string) => void,
): void {
  for (const node of nodes) {
    write(`${"  ".repeat(depth)}${node.label}`);
    if (node.children !== undefined) {
      writeTree(
        node.children as Parameters<typeof writeTree>[0],
        depth + 1,
        write,
      );
    }
  }
}

const DIAGNOSTIC_SYMBOL: Readonly<Record<Diagnostic["severity"], string>> = {
  error: "✖",
  warn: "⚠",
  info: "ℹ",
};

export function writeDiagnostic(
  stream: { write(text: string): void },
  diagnostic: Diagnostic,
): void {
  stream.write(
    `${DIAGNOSTIC_SYMBOL[diagnostic.severity]} [${diagnostic.code}] ${diagnostic.summary}\n`,
  );
  if (diagnostic.why !== undefined) {
    stream.write(`  why: ${diagnostic.why}\n`);
  }
  for (const action of diagnostic.nextActions) {
    stream.write(`${renderNextAction(action)}\n`);
  }
  if (diagnostic.docsUrl !== undefined) {
    stream.write(`  docs: ${diagnostic.docsUrl}\n`);
  }
}

export function renderNextAction(action: NextAction): string {
  return `→ ${action.label}${action.command === undefined ? "" : `: ${action.command}`}`;
}

/** Populates docsUrl from the owning family's docsBaseUrl (base + code)
 *  when the diagnostic does not carry its own — a per-raise docsUrl wins. */
export function withDocsUrl(
  state: RunState,
  diagnostic: Diagnostic,
): Diagnostic {
  if (diagnostic.docsUrl !== undefined || state.docsBaseUrl === undefined) {
    return diagnostic;
  }
  const base = state.docsBaseUrl.endsWith("/")
    ? state.docsBaseUrl
    : `${state.docsBaseUrl}/`;
  return { ...diagnostic, docsUrl: `${base}${diagnostic.code}` };
}

/** Channel discipline (operator ruling, 2026-08-09): human Blocks,
 *  next-action lines, and diagnostics are presentation prose on stderr;
 *  the materialized `stdout` presentation lines are the machine-usable
 *  payload on stdout, always — human mode stays pipe-clean. */
export function renderCompletedHuman(
  invocation: Invocation,
  presented: PresentedResult<unknown>,
): void {
  const { runtime, state } = invocation;
  for (const block of presented.presentation.human) {
    renderBlock(block, (line) => runtime.stderr.write(`${line}\n`));
  }
  for (const action of presented.presentation.next) {
    runtime.stderr.write(`${renderNextAction(action)}\n`);
  }
  for (const diagnostic of presented.diagnostics) {
    writeDiagnostic(runtime.stderr, withDocsUrl(state, diagnostic));
  }
  for (const line of presented.presentation.stdout) {
    runtime.stdout.write(`${line}\n`);
  }
}
