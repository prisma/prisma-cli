import { dirname, isAbsolute, resolve } from "node:path";
import { type ArkErrors, scope, type Type, type } from "arktype";
import type { SectionProvenance } from "./config-merge";
import type { SectionValidation } from "./config-section";
import type { Diagnostic } from "./protocol";

/**
 * The provenance of the section being validated, published for the
 * duration of one synchronous schema run so the `path` keyword can
 * resolve each value against the file that declared its top-level key.
 */
let current:
  | { readonly name: string; readonly provenance: SectionProvenance }
  | undefined;

/** The file that declared the top-level key a value sits under, else the nearest file. */
function declaringFile(
  provenance: SectionProvenance,
  path: readonly PropertyKey[],
): string | undefined {
  const top = path[0];
  return (
    (typeof top === "string" ? provenance.keys[top] : undefined) ??
    provenance.files[0]
  );
}

/**
 * A `path` value reaches this morph in two situations. During a section
 * validation `current` names the provenance and the value resolves
 * against the file that declared its top-level key. Outside one, arktype
 * is evaluating a literal default while the schema is defined; a relative
 * literal would be stored already resolved against nothing, so it is
 * refused with the thunk form, which arktype evaluates and morphs at
 * application time instead.
 */
function resolvePathValue(value: string, path: readonly PropertyKey[]): string {
  if (isAbsolute(value)) {
    return value;
  }
  if (current === undefined) {
    throw new Error(
      `@prisma/cli-engine: the relative 'path' default '${value}' must be declared as a thunk, ["path", "=", () => "..."], so it resolves against the config file when the default is applied`,
    );
  }
  const file = declaringFile(current.provenance, path);
  return file === undefined ? value : resolve(dirname(file), value);
}

const configScope = scope({
  /**
   * A string relative to the config file that wrote it. Validation turns it
   * into an absolute path against that file's directory; an absolute value
   * passes through unchanged.
   */
  path: type("string").pipe((value, ctx) => resolvePathValue(value, ctx.path)),
});

/**
 * Declares the shape of a config section once. Definitions are arktype
 * definitions with one extra keyword, `path`, for a field holding a path
 * relative to the config file. The declaration drives validation, the
 * diagnostics that name the field and the file to fix, and path
 * resolution; nothing else has to know which fields are paths.
 *
 * ```ts
 * const toySchema = configSchema({
 *   "out?": "path",
 *   "inputs?": "path[]",
 *   dir: ["path", "=", () => "./migrations"],
 *   greeting: "string = 'hello'",
 * });
 * ```
 *
 * A relative `path` default is declared as a thunk, as above: arktype
 * evaluates a thunk when the default is applied, so it resolves against
 * the config file like an authored value. A relative literal default is
 * refused when the schema is defined.
 */
export const configSchema: typeof configScope.type = configScope.type;

export type ConfigSchema<T = unknown> = Type<T, typeof configScope.t>;

/**
 * The validated value a schema produces: its output type plus `baseDir`,
 * the directory of the nearest file declaring the section, which the engine
 * adds to a plain-object value. `baseDir` is reserved: a schema may not
 * declare it and a config file may not write it.
 */
export type ConfigSchemaValue<S extends ConfigSchema> = S["infer"] & {
  readonly baseDir?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * The part of a compiled arktype node this copy reads: a structural node
 * declares object keys (`props`) and, for an array, an element node.
 */
interface StructureLike {
  readonly props?: ReadonlyArray<{
    readonly key: PropertyKey;
    readonly value: NodeLike;
  }>;
  readonly sequence?: { readonly element?: NodeLike };
}

interface NodeLike {
  readonly structure?: StructureLike;
  readonly branches?: readonly NodeLike[];
  /** A morph node validates its `in` side, where the declared structure lives. */
  readonly in?: NodeLike;
  /** Whether a morph (a pipe, or a default) applies at or under this node. */
  readonly includesTransform?: boolean;
}

function structureOf(node: NodeLike | undefined): StructureLike | undefined {
  if (node === undefined) return undefined;
  if (node.structure !== undefined) return node.structure;
  // A morph (a default or a pipe anywhere inside an object literal makes
  // the whole literal one) keeps its declared structure on its `in` side.
  if (node.in !== undefined && node.in !== node) {
    const inner = structureOf(node.in);
    if (inner !== undefined) return inner;
  }
  // A union: the structural branch, if any, is the one arktype may write
  // defaults into.
  return node.branches
    ?.map((branch) => branch.structure)
    .find((s) => s !== undefined);
}

/**
 * Copies `value` along the paths the schema declares as structure, and no
 * further. arktype applies a default by assigning to the parent object, so
 * every plain object on a declared path must be writable even when the
 * config file froze it. A value the schema does not open — an `object`
 * predicate, a `Function`, a `Date` — is user-constructed runtime data:
 * closures over module state, class instances relying on `this`, codec
 * tables. It passes through by reference, which is why a section schema
 * validates such values by predicate rather than by shape.
 */
function copyAlongSchema(value: unknown, node: NodeLike | undefined): unknown {
  const structure = structureOf(node);
  if (structure === undefined) return value;
  if (Array.isArray(value)) {
    const element = structure.sequence?.element;
    return value.map((entry) => copyAlongSchema(entry, element));
  }
  if (!isPlainObject(value)) return value;
  const declared = new Map(
    structure.props?.map((prop) => [prop.key, prop.value]) ?? [],
  );
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      copyAlongSchema(entry, declared.get(key)),
    ]),
  );
}

/**
 * arktype rebuilds an object whenever a morph or a default applies anywhere
 * inside it, and the rebuild deep-clones every property, opaque ones
 * included. An opaque value — an `object` predicate, a `Function`, a `Date`
 * — is user-constructed runtime data: closures over module state, class
 * instances relying on `this`, codec tables. A clone of it is not it. So
 * after validation the input's own value is put back at every path the
 * schema does not open, which is why a section schema validates such values
 * by predicate rather than by shape.
 */
function restoreOpaque(
  input: unknown,
  output: unknown,
  node: NodeLike | undefined,
): unknown {
  const structure = structureOf(node);
  if (structure === undefined) {
    // A node that transforms (a pipe, a resolved path) produced its output
    // on purpose. An untransformed opaque object was merely cloned, and the
    // input is the value the config file built.
    if (node?.includesTransform === true) return output;
    return typeof input === "object" && input !== null ? input : output;
  }
  if (Array.isArray(output)) {
    if (!Array.isArray(input)) return output;
    const element = structure.sequence?.element;
    return output.map((entry, index) =>
      restoreOpaque(input[index], entry, element),
    );
  }
  if (!isPlainObject(output) || !isPlainObject(input)) return output;
  const declared = new Map(
    structure.props?.map((prop) => [prop.key, prop.value]) ?? [],
  );
  return Object.fromEntries(
    Object.entries(output).map(([key, entry]) => [
      key,
      restoreOpaque(input[key], entry, declared.get(key)),
    ]),
  );
}

function fieldDiagnostic(
  name: string,
  error: ArkErrors[number],
  provenance: SectionProvenance,
): Diagnostic {
  const field = error.path.map(String).join(".");
  const file = declaringFile(provenance, error.path);
  return {
    code: "CLI.CONFIG_FIELD_INVALID",
    severity: "error",
    summary: `In the '${name}' section, ${error.message}`,
    nextActions: [
      {
        kind: "edit-file",
        label:
          file === undefined
            ? `Correct ${field === "" ? name : `${name}.${field}`} in prisma.config.ts`
            : `Correct ${field === "" ? name : `${name}.${field}`} in ${file}`,
      },
    ],
    ...(file === undefined ? {} : { where: { path: file } }),
    meta: { section: name, field },
  };
}

/**
 * Validates one section's resolved value against its schema. An absent
 * section is validated as an empty object, so a schema whose fields are
 * all optional accepts it and a required field is reported by name. A
 * plain-object value comes back frozen and carrying `baseDir`, the
 * directory of the nearest file declaring the section. Never throws for
 * any input: arktype reports problems as errors, and a `path` value is
 * only ever resolved here.
 */
export function validateSectionWithSchema<S extends ConfigSchema>(
  name: string,
  schema: S,
  raw: unknown,
  provenance: SectionProvenance,
): SectionValidation<ConfigSchemaValue<S>> {
  if (isPlainObject(raw) && Object.hasOwn(raw, "baseDir")) {
    return {
      ok: false,
      diagnostics: [reservedKeyDiagnostic(name, "baseDir", provenance)],
    };
  }
  const previous = current;
  current = { name, provenance };
  try {
    // arktype writes a default by assigning to the parent object, and the
    // merged section value arrives frozen, so the declared structure is
    // copied first; everything the schema leaves opaque keeps its identity.
    const node = schema.internal as unknown as NodeLike;
    const validated: unknown = schema(
      raw === undefined ? {} : copyAlongSchema(raw, node),
    );
    if (validated instanceof type.errors) {
      return {
        ok: false,
        diagnostics: [...validated].map((error) =>
          fieldDiagnostic(name, error, provenance),
        ),
      };
    }
    const out = restoreOpaque(raw, validated, node);
    if (out instanceof type.errors) {
      return {
        ok: false,
        diagnostics: [...out].map((error) =>
          fieldDiagnostic(name, error, provenance),
        ),
      };
    }
    const nearest = provenance.files[0];
    const value =
      isPlainObject(out) && nearest !== undefined
        ? Object.freeze({ ...out, baseDir: dirname(nearest) })
        : out;
    return { ok: true, value: value as ConfigSchemaValue<S>, diagnostics: [] };
  } catch (cause) {
    // A getter that throws when arktype reads it, or a morph that throws:
    // config-file content, reported as such rather than as a bug.
    return {
      ok: false,
      diagnostics: [unreadableDiagnostic(name, cause, provenance)],
    };
  } finally {
    current = previous;
  }
}

function reservedKeyDiagnostic(
  name: string,
  key: string,
  provenance: SectionProvenance,
): Diagnostic {
  const file = provenance.keys[key] ?? provenance.files[0];
  return {
    code: "CLI.CONFIG_FIELD_INVALID",
    severity: "error",
    summary: `In the '${name}' section, ${key} is reserved: the CLI records it when the section is loaded`,
    nextActions: [
      {
        kind: "edit-file",
        label: `Remove ${name}.${key} from ${file ?? "prisma.config.ts"}`,
      },
    ],
    ...(file === undefined ? {} : { where: { path: file } }),
    meta: { section: name, field: key },
  };
}

function unreadableDiagnostic(
  name: string,
  cause: unknown,
  provenance: SectionProvenance,
): Diagnostic {
  const message = cause instanceof Error ? cause.message : String(cause);
  const file = provenance.files[0];
  return {
    code: "CLI.CONFIG_FIELD_INVALID",
    severity: "error",
    summary: `The '${name}' section could not be validated: ${message.split("\n", 1)[0].trim()}`,
    nextActions: [
      {
        kind: "edit-file",
        label: `Export a plain configuration object for '${name}' in ${file ?? "prisma.config.ts"}`,
      },
    ],
    ...(file === undefined ? {} : { where: { path: file } }),
    meta: { section: name, field: "" },
  };
}
