/**
 * Builds the value-free `EngineCommandSnapshot` for a mounted run —
 * everything `RunHooks.onSettled` may reveal about the invocation.
 * The projection happens at parse time from what the engine already
 * knows: the command's declared flags, the raw argv tokens (consulted
 * only for WHICH flag names appear, never for values), and the parsed
 * positional slots (reduced to a count on the spot).
 */
import { camelCase, flagRuntime, kebabCase } from "../args";
import type { AnyCommand } from "../commands";
import type { EngineCommandSnapshot } from "../run-summary";
import { SHARED_ALIASES, SHARED_FLAG_PARAMETERS } from "./shared-flags";

function declaredFlagKeys(def: AnyCommand): readonly string[] {
  const own = Object.keys(def.args.flags);
  if (def.kind === "server-command") {
    return own;
  }
  return [...Object.keys(SHARED_FLAG_PARAMETERS), ...own];
}

function aliasMap(def: AnyCommand): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  if (def.kind !== "server-command") {
    for (const [alias, key] of Object.entries(SHARED_ALIASES)) {
      aliases.set(alias, key);
    }
  }
  for (const [key, spec] of Object.entries(def.args.flags)) {
    const alias = flagRuntime(spec).alias;
    if (alias !== undefined) {
      aliases.set(alias, key);
    }
  }
  return aliases;
}

/**
 * The flag keys explicitly present on argv, resolved against the
 * command's declared keys and aliases. Long tokens match in both the
 * kebab and camel spellings (the scanner allows kebab-for-camel), a
 * `--no-<flag>` token marks its base flag, and single-dash tokens are
 * resolved character-by-character through the alias map. Everything
 * after a bare `--` is positional and never consulted. Values are
 * irrelevant here: `--name=value` is cut at the `=` before matching.
 */
function explicitFlagKeys(
  def: AnyCommand,
  declared: readonly string[],
  argv: readonly string[],
): ReadonlySet<string> {
  const declaredSet = new Set(declared);
  const aliases = aliasMap(def);
  const explicit = new Set<string>();
  for (const token of argv) {
    if (token === "--") {
      break;
    }
    if (token.startsWith("--")) {
      const equals = token.indexOf("=");
      const raw = token.slice(2, equals === -1 ? undefined : equals);
      const exact = camelCase(raw);
      if (declaredSet.has(exact)) {
        explicit.add(exact);
        continue;
      }
      if (raw.startsWith("no-")) {
        const negated = camelCase(raw.slice(3));
        if (declaredSet.has(negated)) {
          explicit.add(negated);
        }
      }
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      for (const char of token.slice(1)) {
        const key = aliases.get(char);
        if (key !== undefined && declaredSet.has(key)) {
          explicit.add(key);
        }
      }
    }
  }
  return explicit;
}

export function buildCommandSnapshot(
  entryId: string,
  def: AnyCommand,
  argv: readonly string[],
  positionalValues: readonly (string | undefined)[],
): EngineCommandSnapshot {
  const declared = declaredFlagKeys(def);
  const explicit = explicitFlagKeys(def, declared, argv);
  return {
    commandPath: entryId.split("."),
    flags: declared.map((key) => ({
      name: kebabCase(key),
      source: explicit.has(key) ? "cli" : "default",
    })),
    positionalCount: positionalValues.filter((value) => value !== undefined)
      .length,
  };
}
