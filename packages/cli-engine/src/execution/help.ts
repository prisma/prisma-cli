/**
 * Engine-rendered help: the command tree drawn with the same tones the
 * block renderer uses, so help is themed like every other surface.
 * stricli's text_en renderer is never consulted — root and group help
 * list `name  brief` rows, and full signatures appear only on the leaf
 * that owns them.
 */
import {
  type FlagRuntimeSpec,
  flagRuntime,
  kebabCase,
  type PositionalSpec,
  positionalRuntime,
} from "../args";
import type { AnyCommand, WorkflowStep } from "../commands";
import type { Format } from "../presentation";
import type { CommandTreeEntry, CommandTreeNode } from "./command-tree";
import type { EngineSpec } from "./engine";
import { renderHelpMarkdown } from "./markdown";
import { makePaint, type Paint, textWidth } from "./palette";
import { formatFlagGiven, withoutFormatFlags } from "./pre-parse-argv";
import { SHARED_ALIASES, SHARED_FLAG_PARAMETERS } from "./shared-flags";
import { resolveExample } from "./stricli-adapter";

const RAIL = "│";
const GAP = "  ";
const WRAP_WIDTH = 76;

function flagTokens(argv: readonly string[]): readonly string[] {
  const terminator = argv.indexOf("--");
  return terminator === -1 ? argv : argv.slice(0, terminator);
}

export function helpFlagGiven(argv: readonly string[]): boolean {
  return flagTokens(argv).some(
    (token) => token === "-h" || token === "--help" || token === "--help-all",
  );
}

/** The colour decision available before the shared flags are parsed,
 *  read from raw argv: explicit flag, then NO_COLOR, then the TTY of
 *  the stream about to be written. Help and pre-mount failures both
 *  render through this; applySharedFlags re-resolves once a command
 *  actually parses. */
export function preParseColorEnabled(
  argv: readonly string[],
  runtime: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly isTty: { readonly stdout: boolean; readonly stderr: boolean };
  },
  stream: "stdout" | "stderr",
): boolean {
  if (formatFlagGiven(argv) === "markdown") {
    return false;
  }
  const tokens = flagTokens(argv);
  if (tokens.includes("--no-color")) {
    return false;
  }
  if (tokens.includes("--color")) {
    return true;
  }
  if (runtime.env.NO_COLOR !== undefined) {
    return false;
  }
  return runtime.isTty[stream];
}

/** The command path the user asked help for: the leading non-flag
 *  tokens, resolved as far as the tree recognizes them. */
function helpPath(argv: readonly string[]): readonly string[] {
  const segments: string[] = [];
  for (const token of argv) {
    if (token.startsWith("-")) {
      break;
    }
    segments.push(token);
  }
  return segments;
}

type HelpTarget =
  | { readonly kind: "node"; readonly node: CommandTreeNode }
  | { readonly kind: "leaf"; readonly entry: CommandTreeEntry };

/** Walks as far as the segments stay recognized; help for `project
 *  frobnicate` is project's help, not a dead end. */
function resolveTarget(
  root: CommandTreeNode,
  segments: readonly string[],
): { target: HelpTarget; path: readonly string[] } {
  let node = root;
  const path: string[] = [];
  for (const segment of segments) {
    const entry = node.commands.get(segment);
    if (entry !== undefined) {
      return { target: { kind: "leaf", entry }, path: [...path, segment] };
    }
    const child = node.children.get(segment);
    if (child === undefined) {
      break;
    }
    node = child;
    path.push(segment);
  }
  return { target: { kind: "node", node }, path };
}

/** A BARE group invocation (`prisma-cli project`, or no argv at all)
 *  is a help request; anything carrying flags or extra tokens is not —
 *  `cli --unknown` and `cli project --frobnicate` must reach routing
 *  and usage validation, not exit 0 with a help card. A bare leaf is a
 *  command run and is left alone. The format-selection flags do not
 *  count: `cli project --format markdown` asks for the group's help in
 *  Markdown. */
export function bareGroupInvocation(
  root: CommandTreeNode,
  rawArgv: readonly string[],
): boolean {
  const argv = withoutFormatFlags(rawArgv);
  const segments = helpPath(argv);
  if (segments.length !== argv.length) {
    return false;
  }
  if (segments.length === 0) {
    return true;
  }
  const { target, path } = resolveTarget(root, segments);
  return target.kind === "node" && path.length === segments.length;
}

interface HelpWriter {
  write(text: string): void;
}

export interface HelpRow {
  readonly name: string;
  readonly brief: string;
  /** Allowed values, `required`, a default, `(optional)`: appended
   *  after the brief, exactly as the source spelled it. */
  readonly suffix?: string;
}

export interface HelpStep {
  readonly run: string;
  readonly brief: string;
}

/** Everything a help card says, with no rendering decided: the two
 *  renderers draw the same card. */
export interface HelpCard {
  readonly kind: "root" | "group" | "leaf";
  /** `prisma-test project link` */
  readonly name: string;
  /** The root tagline, the group brief, or the leaf summary. */
  readonly tagline: string | undefined;
  /** Leaf only. */
  readonly usage: string | undefined;
  readonly description: string | undefined;
  readonly commands: readonly HelpRow[];
  readonly workflow: readonly HelpStep[];
  readonly arguments: readonly HelpRow[];
  readonly options: readonly HelpRow[];
  /** Root only. */
  readonly globalOptions: readonly HelpRow[];
  /** The leaf's "Global options also apply" line, or the group's
   *  "Run '… --help'" line. */
  readonly note: string | undefined;
  readonly examples: readonly string[];
  readonly docsUrl: string | undefined;
}

export function renderHelp(
  spec: EngineSpec,
  root: CommandTreeNode,
  argv: readonly string[],
  options: { readonly format: Format; readonly colorEnabled: boolean },
  out: HelpWriter,
): void {
  const card = helpCard(spec, root, argv);
  if (options.format === "markdown") {
    out.write(renderHelpMarkdown(card));
    return;
  }
  out.write(renderHelpTerminal(card, makePaint(options.colorEnabled)));
}

export function helpCard(
  spec: EngineSpec,
  root: CommandTreeNode,
  argv: readonly string[],
): HelpCard {
  const { target, path } = resolveTarget(root, helpPath(argv));
  return target.kind === "leaf"
    ? leafCard(spec, target.entry, path)
    : nodeCard(spec, target.node, path);
}

function nodeCard(
  spec: EngineSpec,
  node: CommandTreeNode,
  path: readonly string[],
): HelpCard {
  const atRoot = path.length === 0;
  const groupPath = path.join(" ");
  const group = spec.groups[groupPath];
  return {
    kind: atRoot ? "root" : "group",
    name: [spec.name, ...path].join(" "),
    tagline: atRoot ? spec.help?.tagline : group?.brief,
    usage: undefined,
    description: atRoot ? spec.help?.description : group?.description,
    commands: nodeRows(spec, node, path),
    workflow: resolvedSteps(
      (atRoot ? spec.help?.workflow : group?.workflow) ?? [],
      spec.name,
    ),
    arguments: [],
    options: [],
    globalOptions: atRoot ? sharedFlagRows() : [],
    note: atRoot
      ? undefined
      : `Run '${spec.name} ${groupPath} <command> --help' for details on a command.`,
    examples: resolvedExamples(atRoot ? spec.help?.examples : [], spec.name),
    docsUrl: atRoot ? spec.help?.docsUrl : undefined,
  };
}

function leafCard(
  spec: EngineSpec,
  entry: CommandTreeEntry,
  path: readonly string[],
): HelpCard {
  const def = entry.def;
  const usage = [
    spec.name,
    ...path,
    requiredFlagUsage(def),
    "[options]",
    positionalUsage(def),
  ]
    .filter((part) => part !== "")
    .join(" ");
  const sharedNames = Object.keys(SHARED_FLAG_PARAMETERS)
    .map((key) => `--${kebabCase(key)}`)
    .join(", ");
  return {
    kind: "leaf",
    name: [spec.name, ...path].join(" "),
    tagline: def.help.summary,
    usage,
    description: def.help.description,
    commands: [],
    workflow: [],
    arguments: Object.values<PositionalSpec<unknown>>(def.args.positionals)
      .map((spec) => positionalRuntime(spec))
      .map((runtime) => ({
        name: runtime.placeholder,
        brief: runtime.brief,
        suffix: runtime.type === "optionalString" ? "(optional)" : undefined,
      })),
    options: declaredFlagRows(def),
    globalOptions: [],
    note:
      def.kind === "server-command"
        ? undefined
        : `Global options also apply: ${sharedNames}. Run '${spec.name} --help' for details.`,
    examples: resolvedExamples(def.help.examples, spec.name),
    docsUrl: entry.docsBaseUrl,
  };
}

function resolvedSteps(
  steps: readonly WorkflowStep[],
  cliName: string,
): readonly HelpStep[] {
  return steps.map((step) => ({
    run: resolveExample(step.run, cliName),
    brief: step.brief,
  }));
}

function resolvedExamples(
  examples: readonly string[] | undefined,
  cliName: string,
): readonly string[] {
  return (examples ?? []).map((example) => resolveExample(example, cliName));
}

function renderHelpTerminal(card: HelpCard, paint: Paint): string {
  const lines: string[] = [];
  lines.push(header(card, paint));
  lines.push("");
  if (card.kind === "leaf") {
    lines.push(sectionLabel(paint, "Usage"));
    lines.push(
      rail(
        paint,
        `${GAP}${paint("muted", "$")} ${paint("emphasis", card.usage ?? "")}`,
      ),
    );
  } else {
    railRows(card.commands, paint, lines);
  }
  if (card.description !== undefined) {
    lines.push(rail(paint));
    proseLines(card.description, paint, lines);
  }
  workflowLines(card.workflow, paint, lines);
  rowSection("Arguments", card.arguments, paint, lines);
  rowSection("Options", card.options, paint, lines);
  if (card.kind === "root") {
    lines.push(rail(paint));
    lines.push(sectionLabel(paint, "Global options"));
    railRows(card.globalOptions, paint, lines);
  }
  if (card.note !== undefined) {
    lines.push(rail(paint));
    if (card.kind === "leaf") {
      proseLines(card.note, paint, lines, "muted");
    } else {
      lines.push(rail(paint, paint("muted", card.note)));
    }
  }
  exampleLines(card.examples, paint, lines);
  docsLine(card.docsUrl, paint, lines);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/** `prisma-cli project → Manage and inspect your Prisma projects` */
function header(card: HelpCard, paint: Paint): string {
  const name = paint("emphasis", card.name);
  if (card.tagline === undefined || card.tagline === "") {
    return name;
  }
  return `${name} ${paint("muted", `→ ${card.tagline}`)}`;
}

function rail(paint: Paint, rest = ""): string {
  return rest === ""
    ? paint("structure", RAIL)
    : `${paint("structure", RAIL)}${GAP}${rest}`;
}

function sectionLabel(paint: Paint, label: string): string {
  return rail(paint, paint("muted", label));
}

function rowSection(
  label: string,
  rows: readonly HelpRow[],
  paint: Paint,
  lines: string[],
): void {
  if (rows.length === 0) {
    return;
  }
  lines.push(rail(paint));
  lines.push(sectionLabel(paint, label));
  railRows(rows, paint, lines);
}

/** Two-column rows under the rail: name in the accent, brief plain. */
function railRows(
  rows: readonly HelpRow[],
  paint: Paint,
  lines: string[],
): void {
  const width = Math.max(0, ...rows.map((row) => textWidth(row.name)));
  for (const row of rows) {
    const pad = " ".repeat(width - textWidth(row.name));
    const suffix =
      row.suffix === undefined || row.suffix === ""
        ? ""
        : ` ${paint("muted", row.suffix)}`;
    lines.push(
      rail(
        paint,
        `${paint("identifier", row.name)}${pad}${GAP}${row.brief}${suffix}`,
      ),
    );
  }
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line !== "" && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line === "" ? word : `${line} ${word}`;
      }
    }
    if (line !== "") {
      lines.push(line);
    }
  }
  return lines;
}

function proseLines(
  text: string,
  paint: Paint,
  lines: string[],
  tone: "muted" | "plain" = "plain",
): void {
  for (const line of wrap(text, WRAP_WIDTH)) {
    lines.push(rail(paint, tone === "muted" ? paint("muted", line) : line));
  }
}

function exampleLines(
  examples: readonly string[],
  paint: Paint,
  lines: string[],
): void {
  if (examples.length === 0) {
    return;
  }
  lines.push(rail(paint));
  lines.push(sectionLabel(paint, "Examples"));
  for (const example of examples) {
    lines.push(rail(paint, `${GAP}${paint("muted", "$")} ${example}`));
  }
}

/** The group's common path: `$`-prefixed copy-pastable steps in mount
 *  order, purpose column muted, aligned like every other row block. */
function workflowLines(
  steps: readonly HelpStep[],
  paint: Paint,
  lines: string[],
): void {
  if (steps.length === 0) {
    return;
  }
  lines.push(rail(paint));
  lines.push(sectionLabel(paint, "Workflow"));
  const width = Math.max(...steps.map((step) => textWidth(step.run)));
  for (const step of steps) {
    const pad = " ".repeat(width - textWidth(step.run));
    lines.push(
      rail(
        paint,
        `${GAP}${paint("muted", "$")} ${step.run}${pad}${GAP}${paint("muted", step.brief)}`,
      ),
    );
  }
}

function docsLine(
  url: string | undefined,
  paint: Paint,
  lines: string[],
): void {
  if (url === undefined) {
    return;
  }
  lines.push(rail(paint));
  lines.push(
    rail(paint, `${paint("muted", "Docs")}${GAP}${paint("link", url)}`),
  );
}

/** `--interactive/--no-interactive`, `-q, --quiet`, `--config <path>` —
 *  one spelling rule for shared and declared flags alike. */
function flagLabel(
  key: string,
  spec: {
    readonly kind?: string;
    readonly alias?: string;
    readonly placeholder?: string;
    readonly withNegated?: boolean;
    readonly variadic?: boolean;
  },
): string {
  const kebab = kebabCase(key);
  const alias = spec.alias === undefined ? "   " : `-${spec.alias},`;
  const negated = spec.withNegated === true ? `/--no-${kebab}` : "";
  const placeholder =
    spec.placeholder === undefined ? "" : ` <${spec.placeholder}>`;
  const repeat = spec.variadic === true ? "..." : "";
  return `${alias} --${kebab}${negated}${placeholder}${repeat}`;
}

function sharedFlagRows(): readonly HelpRow[] {
  const aliasByKey = new Map<string, string>(
    Object.entries(SHARED_ALIASES).map(([alias, key]) => [key, alias]),
  );
  const rows = Object.entries(SHARED_FLAG_PARAMETERS).map(([key, spec]) => {
    const record = spec as {
      brief: string;
      kind: string;
      placeholder?: string;
      withNegated?: boolean;
      variadic?: boolean;
      values?: readonly string[];
    };
    return {
      name: flagLabel(key, { ...record, alias: aliasByKey.get(key) }),
      brief: record.brief,
      suffix: record.values === undefined ? undefined : record.values.join("|"),
    };
  });
  return [
    ...rows,
    { name: `-h, --help`, brief: "Print help for a command" },
    { name: `    --version`, brief: "Print the CLI version and exit" },
  ];
}

function declaredFlagRows(def: AnyCommand): readonly HelpRow[] {
  return Object.entries(def.args.flags).map(([key, spec]) => {
    const runtime: FlagRuntimeSpec = flagRuntime(spec);
    return {
      name: flagLabel(key, {
        alias: runtime.alias,
        placeholder:
          runtime.type === "boolean" || runtime.type === "optionalBoolean"
            ? undefined
            : (runtime.placeholder ?? "value"),
        withNegated: runtime.type === "optionalBoolean",
        variadic: runtime.type === "repeated",
      }),
      brief: runtime.brief,
      suffix: flagSuffix(runtime),
    };
  });
}

function flagSuffix(runtime: FlagRuntimeSpec): string | undefined {
  const parts: string[] = [];
  if (runtime.values !== undefined && runtime.values.length > 0) {
    parts.push(runtime.values.join("|"));
  }
  if (runtime.type === "requiredString") {
    parts.push("required");
  }
  if (runtime.default !== undefined) {
    parts.push(`default: ${String(runtime.default)}`);
  }
  return parts.length === 0 ? undefined : `(${parts.join("; ")})`;
}

function positionalUsage(def: AnyCommand): string {
  return Object.values<PositionalSpec<unknown>>(def.args.positionals)
    .map((spec) => {
      const runtime = positionalRuntime(spec);
      if (runtime.type === "optionalString") {
        return `[${runtime.placeholder}]`;
      }
      if (runtime.type === "variadic") {
        return `[${runtime.placeholder}...]`;
      }
      return `<${runtime.placeholder}>`;
    })
    .join(" ");
}

function requiredFlagUsage(def: AnyCommand): string {
  return Object.entries(def.args.flags)
    .flatMap(([key, spec]) => {
      const runtime = flagRuntime(spec);
      return runtime.type === "requiredString"
        ? [`--${kebabCase(key)} <${runtime.placeholder ?? "value"}>`]
        : [];
    })
    .join(" ");
}

/** Mount order, not map-partition order: a leaf and a group list in
 *  the order their first command was mounted. */
function nodeRows(
  spec: EngineSpec,
  node: CommandTreeNode,
  path: readonly string[],
): HelpRow[] {
  const groupPath = path.join(" ");
  const depth = path.length;
  const seen = new Set<string>();
  const rows: HelpRow[] = [];
  for (const mounted of Object.keys(spec.commands)) {
    const segments = mounted.split(" ");
    if (
      segments.length <= depth ||
      segments.slice(0, depth).join(" ") !== groupPath
    ) {
      continue;
    }
    const name = segments[depth];
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const entry = node.commands.get(name);
    if (entry !== undefined) {
      rows.push({
        name: usageName(name, entry.def),
        brief: entry.def.help.summary,
      });
    } else if (node.children.has(name)) {
      const childPath = depth === 0 ? name : `${groupPath} ${name}`;
      rows.push({ name, brief: spec.groups[childPath]?.brief ?? "" });
    }
  }
  return rows;
}

/** `link [id-or-name]` — the row a group lists for a leaf: name plus
 *  positional shape, briefs carry the rest. */
function usageName(name: string, def: AnyCommand): string {
  const positionals = positionalUsage(def);
  return positionals === "" ? name : `${name} ${positionals}`;
}
