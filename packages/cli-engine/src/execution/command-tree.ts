import {
  flagRuntime,
  type PositionalSpec,
  positionalRuntime,
} from "../definition/args";
import type { CommandFamily } from "../definition/command-family";
import type { AnyCommand } from "../definition/commands";
import type { EngineSpec } from "./invocation";
import { RESERVED_ALIASES, RESERVED_FLAG_NAMES } from "./shared-flags";

export function constructionError(message: string): Error {
  return new Error(`@prisma/cli-engine: ${message}`);
}

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;
const INTEGER_LIKE = /^\d+$/;

function validateFlags(path: string, def: AnyCommand): void {
  const flags = def.args?.flags ?? {};
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
  const entries = Object.entries<PositionalSpec<unknown>>(
    def.args?.positionals ?? {},
  );
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
  if (def.kind !== "result-command" || def.exitCodes === undefined) {
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
  return spec.commandFamilies.find((family) =>
    Object.values(family.commands).includes(def),
  );
}

function validateSectionOwnership(
  spec: EngineSpec,
  path: string,
  def: AnyCommand,
): void {
  const section = def.needs?.config;
  if (section === undefined) {
    return;
  }
  const family = commandFamilyOf(spec, def);
  if (family === undefined) {
    return;
  }
  if (family.configSection !== section) {
    throw constructionError(
      `command '${path}' needs the '${section.name}' config section, which is not its command family's section`,
    );
  }
}

export function buildCommandTree(spec: EngineSpec): CommandTreeNode {
  const paths = Object.keys(spec.commands);
  if (paths.length === 0) {
    throw constructionError("createCli requires at least one mounted command");
  }
  const root = emptyNode();
  for (const path of paths) {
    const def = spec.commands[path];
    validateFlags(path, def);
    validatePositionals(path, def);
    validateExitCodes(path, def);
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
