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
import type { AnyCommand } from "../commands";
import type { CommandTreeEntry, CommandTreeNode } from "./command-tree";
import type { EngineSpec } from "./engine";
import { makePaint, type Paint, textWidth } from "./palette";
import { SHARED_ALIASES, SHARED_FLAG_PARAMETERS } from "./shared-flags";
import { NO_JSON_NOTE, resolveExample } from "./stricli-adapter";

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
 *  command run and is left alone. */
export function bareGroupInvocation(
  root: CommandTreeNode,
  argv: readonly string[],
): boolean {
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

export function renderHelp(
  spec: EngineSpec,
  root: CommandTreeNode,
  argv: readonly string[],
  colorEnabled: boolean,
  out: HelpWriter,
): void {
  const paint = makePaint(colorEnabled);
  const { target, path } = resolveTarget(root, helpPath(argv));
  const lines: string[] = [];
  if (target.kind === "leaf") {
    renderLeafHelp(spec, target.entry, path, paint, lines);
  } else {
    renderNodeHelp(spec, target.node, path, paint, lines);
  }
  out.write(`${lines.join("\n")}\n`);
}

/** `prisma-cli project → Manage and inspect your Prisma projects` */
function header(
  spec: EngineSpec,
  path: readonly string[],
  tagline: string | undefined,
  paint: Paint,
): string {
  const name = paint("emphasis", [spec.name, ...path].join(" "));
  if (tagline === undefined || tagline === "") {
    return name;
  }
  return `${name} ${paint("muted", `→ ${tagline}`)}`;
}

function rail(paint: Paint, rest = ""): string {
  return rest === ""
    ? paint("structure", RAIL)
    : `${paint("structure", RAIL)}${GAP}${rest}`;
}

function sectionLabel(paint: Paint, label: string): string {
  return rail(paint, paint("muted", label));
}

/** Two-column rows under the rail: name in the accent, brief plain. */
function railRows(
  rows: ReadonlyArray<{ name: string; brief: string; suffix?: string }>,
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
  cliName: string,
  paint: Paint,
  lines: string[],
): void {
  if (examples.length === 0) {
    return;
  }
  lines.push(rail(paint));
  lines.push(sectionLabel(paint, "Examples"));
  for (const example of examples) {
    lines.push(
      rail(
        paint,
        `${GAP}${paint("muted", "$")} ${resolveExample(example, cliName)}`,
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

function sharedFlagRows(): ReadonlyArray<{
  name: string;
  brief: string;
  suffix?: string;
}> {
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

function declaredFlagRows(
  def: AnyCommand,
): ReadonlyArray<{ name: string; brief: string; suffix?: string }> {
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
): Array<{ name: string; brief: string }> {
  const groupPath = path.join(" ");
  const depth = path.length;
  const seen = new Set<string>();
  const rows: Array<{ name: string; brief: string }> = [];
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

function renderNodeHelp(
  spec: EngineSpec,
  node: CommandTreeNode,
  path: readonly string[],
  paint: Paint,
  lines: string[],
): void {
  const atRoot = path.length === 0;
  const groupPath = path.join(" ");
  const tagline = atRoot ? spec.help?.tagline : spec.groups[groupPath]?.brief;
  lines.push(header(spec, path, tagline, paint));
  lines.push("");
  railRows(nodeRows(spec, node, path), paint, lines);

  const description = atRoot
    ? spec.help?.description
    : spec.groups[groupPath]?.description;
  if (description !== undefined) {
    lines.push(rail(paint));
    proseLines(description, paint, lines);
  }

  if (atRoot) {
    lines.push(rail(paint));
    lines.push(sectionLabel(paint, "Global options"));
    railRows(sharedFlagRows(), paint, lines);
    exampleLines(spec.help?.examples ?? [], spec.name, paint, lines);
    docsLine(spec.help?.docsUrl, paint, lines);
  } else {
    lines.push(rail(paint));
    lines.push(
      rail(
        paint,
        paint(
          "muted",
          `Run '${spec.name} ${groupPath} <command> --help' for details on a command.`,
        ),
      ),
    );
  }
  lines.push("");
}

/** `link [id-or-name]` — the row a group lists for a leaf: name plus
 *  positional shape, briefs carry the rest. */
function usageName(name: string, def: AnyCommand): string {
  const positionals = positionalUsage(def);
  return positionals === "" ? name : `${name} ${positionals}`;
}

function renderLeafHelp(
  spec: EngineSpec,
  entry: CommandTreeEntry,
  path: readonly string[],
  paint: Paint,
  lines: string[],
): void {
  const def = entry.def;
  lines.push(header(spec, path, def.help.summary, paint));
  lines.push("");

  const usageParts = [
    spec.name,
    ...path,
    requiredFlagUsage(def),
    "[options]",
    positionalUsage(def),
  ].filter((part) => part !== "");
  lines.push(sectionLabel(paint, "Usage"));
  lines.push(
    rail(
      paint,
      `${GAP}${paint("muted", "$")} ${paint("emphasis", usageParts.join(" "))}`,
    ),
  );

  if (def.help.description !== undefined) {
    lines.push(rail(paint));
    proseLines(def.help.description, paint, lines);
  }
  if (def.maySpawn) {
    lines.push(rail(paint));
    // One line on purpose: the sentence is the contract several tests
    // and consumers grep for, so it never wraps.
    lines.push(rail(paint, paint("muted", NO_JSON_NOTE)));
  }

  const positionalEntries = Object.values<PositionalSpec<unknown>>(
    def.args.positionals,
  ).map((spec) => positionalRuntime(spec));
  if (positionalEntries.length > 0) {
    lines.push(rail(paint));
    lines.push(sectionLabel(paint, "Arguments"));
    railRows(
      positionalEntries.map((runtime) => ({
        name: runtime.placeholder,
        brief: runtime.brief,
        suffix: runtime.type === "optionalString" ? "(optional)" : undefined,
      })),
      paint,
      lines,
    );
  }

  const flagRows = declaredFlagRows(def);
  if (flagRows.length > 0) {
    lines.push(rail(paint));
    lines.push(sectionLabel(paint, "Options"));
    railRows(flagRows, paint, lines);
  }

  if (def.kind !== "server-command") {
    const sharedNames = [
      ...Object.keys(SHARED_FLAG_PARAMETERS).map(
        (key) => `--${kebabCase(key)}`,
      ),
    ].join(", ");
    lines.push(rail(paint));
    proseLines(
      `Global options also apply: ${sharedNames}. Run '${spec.name} --help' for details.`,
      paint,
      lines,
      "muted",
    );
  }

  exampleLines(def.help.examples, spec.name, paint, lines);
  docsLine(entry.docsBaseUrl, paint, lines);
  lines.push("");
}
