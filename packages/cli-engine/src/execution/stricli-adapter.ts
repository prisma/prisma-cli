/**
 * The stricli boundary — fully internal: no stricli type appears in the
 * public surface, and stricli never owns process lifetime. Maps command
 * definitions onto stricli commands and captures stricli's own text so
 * it can be re-shaped into engine envelopes.
 */
import {
  type ApplicationText,
  buildCommand,
  buildRouteMap,
  type CommandContext as StricliBaseContext,
  type Command as StricliCommand,
  type RouteMap as StricliRouteMap,
  type TypedCommandParameters,
  text_en,
} from "@stricli/core";
import {
  type FlagRuntimeSpec,
  flagRuntime,
  type PositionalRuntimeSpec,
  type PositionalSpec,
  positionalRuntime,
} from "../args";
import type { AnyCommand } from "../commands";
import type { CommandTreeEntry, CommandTreeNode } from "./command-tree";
import type { EngineSpec, Invocation, RunState } from "./invocation";
import { SHARED_ALIASES, SHARED_FLAG_PARAMETERS } from "./shared-flags";

export interface EngineRunContext extends StricliBaseContext {
  readonly invocation: Invocation;
}

export type EngineRoutingTarget =
  | StricliCommand<EngineRunContext>
  | StricliRouteMap<EngineRunContext>;

export type RunEntry = (
  invocation: Invocation,
  entry: CommandTreeEntry,
  flags: Record<string, unknown>,
  values: readonly (string | undefined)[],
) => Promise<void>;

function parseNumberInput(input: string): number {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    throw new Error(`expected a number, received '${input}'`);
  }
  return value;
}

function identity(input: string): string {
  return input;
}

function stricliFlagParameter(spec: FlagRuntimeSpec): Record<string, unknown> {
  switch (spec.type) {
    case "boolean":
      return { kind: "boolean", brief: spec.brief, default: false };
    case "enum":
      return {
        kind: "enum",
        brief: spec.brief,
        values: spec.values ?? [],
        ...(spec.default === undefined
          ? { optional: true }
          : { default: spec.default }),
      };
    case "repeated":
      return {
        kind: "parsed",
        parse: identity,
        brief: spec.brief,
        placeholder: spec.placeholder,
        variadic: true,
        optional: true,
      };
    case "number":
      return {
        kind: "parsed",
        parse: parseNumberInput,
        brief: spec.brief,
        placeholder: spec.placeholder,
        ...(spec.default === undefined
          ? { optional: true }
          : { default: String(spec.default) }),
      };
    case "requiredString":
      return {
        kind: "parsed",
        parse: identity,
        brief: spec.brief,
        placeholder: spec.placeholder,
      };
    case "string":
      return {
        kind: "parsed",
        parse: identity,
        brief: spec.brief,
        placeholder: spec.placeholder,
        ...(spec.default === undefined
          ? { optional: true }
          : { default: spec.default }),
      };
  }
}

function stricliPositional(
  entries: ReadonlyArray<readonly [string, PositionalRuntimeSpec]>,
): Record<string, unknown> | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  const variadic = entries.find(([, spec]) => spec.type === "variadic");
  if (variadic === undefined) {
    return {
      kind: "tuple",
      parameters: entries.map(([, spec]) => ({
        brief: spec.brief,
        placeholder: spec.placeholder,
        parse: identity,
        ...(spec.type === "optionalString" ? { optional: true } : {}),
      })),
    };
  }
  const minimum = entries.filter(([, spec]) => spec.type === "string").length;
  return {
    kind: "array",
    parameter: {
      brief: variadic[1].brief,
      placeholder: variadic[1].placeholder,
      parse: identity,
      optional: true,
    },
    ...(minimum > 0 ? { minimum } : {}),
  };
}

function commandParameters(def: AnyCommand): Record<string, unknown> {
  const declaredFlags: Record<string, unknown> = {};
  const aliases: Record<string, string> = {};
  for (const [key, spec] of Object.entries(def.args?.flags ?? {})) {
    const runtime = flagRuntime(spec);
    declaredFlags[key] = stricliFlagParameter(runtime);
    if (runtime.alias !== undefined) {
      aliases[runtime.alias] = key;
    }
  }
  const injectShared = def.kind !== "server-command";
  const positionalEntries = Object.entries<PositionalSpec<unknown>>(
    def.args?.positionals ?? {},
  ).map(([key, spec]) => [key, positionalRuntime(spec)] as const);
  const positional = stricliPositional(positionalEntries);
  return {
    flags: injectShared
      ? { ...SHARED_FLAG_PARAMETERS, ...declaredFlags }
      : declaredFlags,
    aliases: injectShared ? { ...SHARED_ALIASES, ...aliases } : aliases,
    ...(positional === undefined ? {} : { positional }),
  };
}

/** Help examples never contain the binary name (operator ruling,
 *  2026-08-09): `{bin}` is substituted with the CLI name; an example
 *  without `{bin}` gets the name prepended. */
function resolveExample(example: string, cliName: string): string {
  return example.includes("{bin}")
    ? example.replaceAll("{bin}", cliName)
    : `${cliName} ${example}`;
}

function commandDocs(
  def: AnyCommand,
  cliName: string,
): { brief: string; fullDescription?: string } {
  const examples = (def.help.examples ?? []).map((example) =>
    resolveExample(example, cliName),
  );
  if (examples.length === 0) {
    return { brief: def.help.summary, fullDescription: def.help.description };
  }
  return {
    brief: def.help.summary,
    fullDescription: [
      def.help.description ?? def.help.summary,
      "",
      "Examples:",
      ...examples.map((example) => `  ${example}`),
    ].join("\n"),
  };
}

function toStricliCommand(
  entry: CommandTreeEntry,
  cliName: string,
  runEntry: RunEntry,
): EngineRoutingTarget {
  const parameters = commandParameters(
    entry.def,
  ) as unknown as TypedCommandParameters<
    Record<string, unknown>,
    readonly (string | undefined)[],
    EngineRunContext
  >;
  return buildCommand<
    Record<string, unknown>,
    readonly (string | undefined)[],
    EngineRunContext
  >({
    async func(
      this: EngineRunContext,
      flags: Record<string, unknown>,
      ...values: (string | undefined)[]
    ): Promise<void> {
      await runEntry(this.invocation, entry, flags, values);
    },
    parameters,
    docs: commandDocs(entry.def, cliName),
  });
}

export function buildRoutes(
  spec: EngineSpec,
  node: CommandTreeNode,
  groupPath: string,
  runEntry: RunEntry,
): StricliRouteMap<EngineRunContext> {
  const routes: Record<string, EngineRoutingTarget> = {};
  for (const [name, entry] of node.commands) {
    routes[name] = toStricliCommand(entry, spec.name, runEntry);
  }
  for (const [name, child] of node.children) {
    const childPath = groupPath === "" ? name : `${groupPath} ${name}`;
    routes[name] = buildRoutes(spec, child, childPath, runEntry);
  }
  const docs =
    groupPath === ""
      ? { brief: spec.name }
      : {
          brief: spec.groups[groupPath].brief,
          fullDescription: spec.groups[groupPath].description,
        };
  return buildRouteMap({ routes, docs });
}

export function capturingText(state: RunState): ApplicationText {
  return {
    ...text_en,
    exceptionWhileParsingArguments(exc, ansiColor) {
      const message = text_en.exceptionWhileParsingArguments.call(
        text_en,
        exc,
        ansiColor,
      );
      state.usageErrorText = message;
      return message;
    },
    noCommandRegisteredForInput(args) {
      const message = text_en.noCommandRegisteredForInput(args);
      state.usageErrorText = message;
      return message;
    },
    exceptionWhileLoadingCommandFunction(exc, ansiColor) {
      const message = text_en.exceptionWhileLoadingCommandFunction.call(
        text_en,
        exc,
        ansiColor,
      );
      state.internalErrorText = message;
      return message;
    },
    exceptionWhileRunningCommand(exc, ansiColor) {
      const message = text_en.exceptionWhileRunningCommand.call(
        text_en,
        exc,
        ansiColor,
      );
      state.internalErrorText = message;
      return message;
    },
  };
}

export function usageErrorCode(
  stricliExitCode: number,
): `${string}.${string}` | undefined {
  if (stricliExitCode === -5) {
    return "CLI.UNKNOWN_COMMAND";
  }
  if (stricliExitCode === -4) {
    return "CLI.INVALID_ARGUMENTS";
  }
  return undefined;
}
