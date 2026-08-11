import {
  camelCase,
  flagRuntime,
  type PositionalSpec,
  positionalRuntime,
} from "../args";
import type { CommandFamily, CommandRedirect } from "../command-family";
import type { AnyCommand } from "../commands";
import { reservedConfigSectionName } from "../config-loader";
import type { ConfigSection } from "../config-section";
import type { EngineSpec } from "./engine";
import { RESERVED_ALIASES, RESERVED_FLAG_NAMES } from "./shared-flags";

export function constructionError(message: string): Error {
  return new Error(`@prisma/cli-engine: ${message}`);
}

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;
const INTEGER_LIKE = /^\d+$/;

function validateFlags(path: string, def: AnyCommand): void {
  const flags = def.args.flags;
  const seenAliases = new Set<string>();
  for (const [key, spec] of Object.entries(flags)) {
    if (RESERVED_FLAG_NAMES.has(key)) {
      throw constructionError(
        `command '${path}' declares reserved flag '${key}' (the shared flag family is engine-injected)`,
      );
    }
    if (!CAMEL_CASE.test(key)) {
      throw constructionError(
        `command '${path}' flag '${key}' must be camelCase (it transliterates to --kebab-case on the CLI)`,
      );
    }
    const alias = flagRuntime(spec).alias;
    if (alias === undefined) {
      continue;
    }
    if (RESERVED_ALIASES.has(alias)) {
      throw constructionError(
        `command '${path}' flag '${key}' uses reserved alias '-${alias}'`,
      );
    }
    if (seenAliases.has(alias)) {
      throw constructionError(
        `command '${path}' declares alias '-${alias}' twice`,
      );
    }
    seenAliases.add(alias);
  }
}

function validatePositionals(path: string, def: AnyCommand): void {
  const entries = Object.entries<PositionalSpec<unknown>>(def.args.positionals);
  let sawOptional = false;
  for (const [index, [key, spec]] of entries.entries()) {
    const runtime = positionalRuntime(spec);
    if (INTEGER_LIKE.test(key)) {
      throw constructionError(
        `command '${path}' positional key '${key}' must not be integer-like`,
      );
    }
    if (runtime.type === "variadic" && index !== entries.length - 1) {
      throw constructionError(
        `command '${path}' variadic positional '${key}' must be declared last`,
      );
    }
    if (runtime.type === "optionalString") {
      sawOptional = true;
    }
    if (runtime.type === "string" && sawOptional) {
      throw constructionError(
        `command '${path}' required positional '${key}' may not follow an optional one`,
      );
    }
  }
}

function validateExitCodes(path: string, def: AnyCommand): void {
  if (def.kind !== "result-command") {
    return;
  }
  for (const key of Object.keys(def.exitCodes)) {
    const code = Number(key);
    if (!Number.isInteger(code) || code < 4 || code > 99) {
      throw constructionError(
        `command '${path}' documents exit code ${key}; documented codes must be integers in 4-99`,
      );
    }
  }
}

function validateSpawnDeclarations(path: string, def: AnyCommand): void {
  if (def.needs.credentials === "child" && !def.maySpawn) {
    throw constructionError(
      `command '${path}' needs credentials for a child without declaring maySpawn (there is nothing to hand credentials to)`,
    );
  }
}

export interface CommandTreeEntry {
  readonly def: AnyCommand;
  readonly id: string;
  readonly docsBaseUrl: string | undefined;
}

export interface CommandTreeNode {
  readonly commands: Map<string, CommandTreeEntry>;
  readonly children: Map<string, CommandTreeNode>;
}

function emptyNode(): CommandTreeNode {
  return { commands: new Map(), children: new Map() };
}

function insertCommand(
  root: CommandTreeNode,
  path: string,
  def: AnyCommand,
  docsBaseUrl: string | undefined,
): void {
  const segments = path.split(" ");
  if (segments.some((segment) => segment.length === 0)) {
    throw constructionError(`invalid command path '${path}'`);
  }
  let node = root;
  for (const segment of segments.slice(0, -1)) {
    if (node.commands.has(segment)) {
      throw constructionError(
        `command path '${path}' collides with a command mounted at a prefix of it`,
      );
    }
    let child = node.children.get(segment);
    if (child === undefined) {
      child = emptyNode();
      node.children.set(segment, child);
    }
    node = child;
  }
  const leaf = segments[segments.length - 1];
  if (node.commands.has(leaf) || node.children.has(leaf)) {
    throw constructionError(
      `command path '${path}' collides with another mounted command`,
    );
  }
  node.commands.set(leaf, { def, id: segments.join("."), docsBaseUrl });
}

/** A command belongs to the family whose commands record contains it
 *  (identity). Harness-mounted commands with no family are unowned. */
function commandFamilyOf(
  spec: EngineSpec,
  def: AnyCommand,
): CommandFamily | undefined {
  return spec.commandFamilies.find((commandFamily) =>
    Object.values(commandFamily.commands).includes(def),
  );
}

function validateSectionOwnership(
  spec: EngineSpec,
  path: string,
  def: AnyCommand,
): void {
  const section = def.needs.config;
  if (section === undefined) {
    return;
  }
  const commandFamily = commandFamilyOf(spec, def);
  if (commandFamily === undefined) {
    return;
  }
  if (commandFamily.configSection !== section) {
    throw constructionError(
      `command '${path}' needs the '${section.name}' config section, which is not its command family's section`,
    );
  }
}

/** The config file's top-level keys are the declared section names, so
 *  a section may only be named something the file format leaves free:
 *  not `$`-prefixed (those are metadata — $prismaConfig is the version
 *  marker, and a $meta key is deleted before the loader ever sees it),
 *  and not `extends` (the key config loaders take as an instruction to
 *  merge another file in). Both the families and the commands mounted
 *  without one are checked: whoever declares the section, claiming a
 *  reserved name is broken at build time, not at a user's runtime. */
function validateConfigSectionNames(spec: EngineSpec): void {
  for (const commandFamily of spec.commandFamilies) {
    rejectReservedSectionName("command family", commandFamily.configSection);
  }
  for (const [path, def] of Object.entries(spec.commands)) {
    rejectReservedSectionName(`command '${path}'`, def.needs.config);
  }
}

function rejectReservedSectionName(
  owner: string,
  section: ConfigSection<unknown> | undefined,
): void {
  if (section === undefined || !reservedConfigSectionName(section.name)) {
    return;
  }
  throw constructionError(
    `${owner} declares config section '${section.name}', a name the config file reserves ('extends' is a config loader's merge directive, and '$'-prefixed keys are metadata)`,
  );
}

function validateDocsBaseUrls(spec: EngineSpec): void {
  for (const commandFamily of spec.commandFamilies) {
    const base = commandFamily.docsBaseUrl;
    if (base !== undefined && !URL.canParse(base)) {
      throw constructionError(
        `command family docsBaseUrl '${base}' is not a valid URL`,
      );
    }
  }
}

export function buildCommandTree(spec: EngineSpec): CommandTreeNode {
  const paths = Object.keys(spec.commands);
  if (paths.length === 0) {
    throw constructionError("createCli requires at least one mounted command");
  }
  validateDocsBaseUrls(spec);
  validateConfigSectionNames(spec);
  const root = emptyNode();
  for (const path of paths) {
    const def = spec.commands[path];
    validateFlags(path, def);
    validatePositionals(path, def);
    validateExitCodes(path, def);
    validateSpawnDeclarations(path, def);
    validateSectionOwnership(spec, path, def);
    const segments = path.split(" ");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const groupPath = segments.slice(0, depth).join(" ");
      if (spec.groups[groupPath] === undefined) {
        throw constructionError(
          `command path '${path}' references unknown group '${groupPath}' (declare it in createCli's groups)`,
        );
      }
    }
    insertCommand(root, path, def, commandFamilyOf(spec, def)?.docsBaseUrl);
  }
  return root;
}

/**
 * Every mounted command family's retired invocations, merged and keyed
 * for lookup. The two halves never compete: `byPath` is consulted when
 * argv routes to no command, `byFlag` when a live command's parse fails
 * on an unknown flag.
 */
export interface RedirectTable {
  readonly byPath: ReadonlyMap<string, CommandRedirect>;
  readonly byFlag: ReadonlyMap<string, CommandRedirect>;
}

function flagRedirectKey(commandPath: string, flag: string): string {
  return `${commandPath} --${flag}`;
}

/** Where a path sits in the mounted tree; a group is a path some
 *  command mounts under. */
function mountedAs(
  spec: EngineSpec,
  path: string,
): "command" | "command group" | undefined {
  if (spec.commands[path] !== undefined) {
    return "command";
  }
  const groupPrefix = `${path} `;
  return Object.keys(spec.commands).some((mounted) =>
    mounted.startsWith(groupPrefix),
  )
    ? "command group"
    : undefined;
}

/** Engine-injected shared flags count: a command answers them whether
 *  or not it declared them, so a redirect for one could never fire. */
function acceptsFlag(def: AnyCommand, flag: string): boolean {
  if (def.args.flags[flag] !== undefined) {
    return true;
  }
  return def.kind !== "server-command" && RESERVED_FLAG_NAMES.has(flag);
}

function addVerbRedirect(
  spec: EngineSpec,
  table: Map<string, CommandRedirect>,
  redirect: CommandRedirect,
): void {
  const mounted = mountedAs(spec, redirect.from);
  if (mounted !== undefined) {
    throw constructionError(
      `redirect '${redirect.from}' collides with a mounted ${mounted}`,
    );
  }
  if (table.has(redirect.from)) {
    throw constructionError(`redirect '${redirect.from}' is declared twice`);
  }
  table.set(redirect.from, redirect);
}

function addFlagRedirect(
  spec: EngineSpec,
  table: Map<string, CommandRedirect>,
  redirect: CommandRedirect,
  flag: string,
): void {
  const def = spec.commands[redirect.from];
  if (def === undefined) {
    throw constructionError(
      `redirect for flag '${flag}' names '${redirect.from}', which is not a mounted command`,
    );
  }
  if (acceptsFlag(def, flag)) {
    throw constructionError(
      `redirect for flag '${flag}' on '${redirect.from}' names a flag that command still accepts`,
    );
  }
  const key = flagRedirectKey(redirect.from, flag);
  if (table.has(key)) {
    throw constructionError(
      `redirect for flag '${flag}' on '${redirect.from}' is declared twice`,
    );
  }
  table.set(key, redirect);
}

export function buildRedirectTable(spec: EngineSpec): RedirectTable {
  const byPath = new Map<string, CommandRedirect>();
  const byFlag = new Map<string, CommandRedirect>();
  for (const commandFamily of spec.commandFamilies) {
    for (const redirect of commandFamily.redirects) {
      if (redirect.flag === undefined) {
        addVerbRedirect(spec, byPath, redirect);
      } else {
        addFlagRedirect(spec, byFlag, redirect, redirect.flag);
      }
    }
  }
  return { byPath, byFlag };
}

/** Longest match wins, since one retired path may prefix another.
 *  Segments match exactly: a redirect is never a spelling suggestion. */
export function matchVerbRedirect(
  table: RedirectTable,
  segments: readonly string[],
): CommandRedirect | undefined {
  for (let length = segments.length; length > 0; length -= 1) {
    const redirect = table.byPath.get(segments.slice(0, length).join(" "));
    if (redirect !== undefined) {
      return redirect;
    }
  }
  return undefined;
}

/** `typedFlags` are spelled as the user typed them, without the leading
 *  dashes; the scanner accepts kebab for camel, so both spellings
 *  resolve to the declared camelCase name. */
export function matchFlagRedirect(
  table: RedirectTable,
  commandPath: string,
  typedFlags: readonly string[],
): CommandRedirect | undefined {
  for (const typed of typedFlags) {
    const redirect = table.byFlag.get(
      flagRedirectKey(commandPath, camelCase(typed)),
    );
    if (redirect !== undefined) {
      return redirect;
    }
  }
  return undefined;
}
