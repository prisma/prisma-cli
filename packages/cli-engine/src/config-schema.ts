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
 * The part of a compiled arktype node the copy and restore walks read. A
 * structural node declares object keys (`props`), a tuple's positions
 * (`sequence.prefix`), a list's element (`sequence.element`), or index
 * signatures (`index`). A union offers `branches`; a morph keeps its
 * declared structure on its `in` side.
 */
interface StructureLike {
  readonly props?: ReadonlyArray<{
    readonly key: PropertyKey;
    readonly value: NodeLike;
  }>;
  readonly sequence?: {
    readonly prefix?: readonly NodeLike[];
    readonly element?: NodeLike;
  };
  readonly index?: readonly unknown[];
}

interface NodeLike {
  readonly structure?: StructureLike;
  readonly branches?: readonly NodeLike[];
  readonly in?: NodeLike;
  /** Whether a morph (a pipe, or a default) applies at or under this node. */
  readonly includesTransform?: boolean;
  readonly allows?: (value: unknown) => boolean;
}

/**
 * The node that governs `value` at this position: the node itself, a
 * morph's `in` side, or the union branch that accepts the value. Undefined
 * for a union no branch of which accepts the value, which validation is
 * about to report anyway.
 */
function governingNode(
  node: NodeLike | undefined,
  value: unknown,
): NodeLike | undefined {
  if (node === undefined) return undefined;
  if (node.branches !== undefined && node.branches.length > 1) {
    const branch = node.branches.find(
      (candidate) => candidate.allows?.(value) === true,
    );
    return branch === undefined ? undefined : governingNode(branch, value);
  }
  if (
    node.structure === undefined &&
    node.in !== undefined &&
    node.in !== node
  ) {
    const inner = governingNode(node.in, value);
    return inner?.structure === undefined ? node : inner;
  }
  return node;
}

function structureOf(
  node: NodeLike | undefined,
  value: unknown,
): StructureLike | undefined {
  const structure = governingNode(node, value)?.structure;
  if (structure?.index !== undefined && structure.index.length > 0) {
    throw new Error(
      "@prisma/cli-engine: a config section schema cannot declare an index signature; declare the keys, or validate the value by predicate",
    );
  }
  return structure;
}

/** The node for array position `index`: a tuple's own position, else the list element. */
function elementNode(
  structure: StructureLike,
  index: number,
): NodeLike | undefined {
  return structure.sequence?.prefix?.[index] ?? structure.sequence?.element;
}

/**
 * Copies `value` along the paths the schema declares as structure, and no
 * further, so arktype can assign a default to a parent object the config
 * file froze. Everything the schema leaves opaque passes through untouched.
 */
function copyAlongSchema(value: unknown, node: NodeLike | undefined): unknown {
  const structure = structureOf(node, value);
  if (structure === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      copyAlongSchema(entry, elementNode(structure, index)),
    );
  }
  if (!isPlainObject(value)) return value;
  const declared = new Map(
    structure.props?.map((prop) => [prop.key, prop.value]) ?? [],
  );
  return Object.fromEntries(
    Reflect.ownKeys(value).map((key) => [
      key,
      copyAlongSchema(
        (value as Record<PropertyKey, unknown>)[key],
        declared.get(key),
      ),
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
 * by predicate rather than by shape. A transformed node (a pipe, a resolved
 * path) produced its output on purpose and keeps it.
 */
function restoreOpaque(
  input: unknown,
  output: unknown,
  node: NodeLike | undefined,
): unknown {
  const governing = governingNode(node, output);
  const structure = structureOf(governing, output);
  if (structure === undefined) {
    if (governing?.includesTransform === true) return output;
    return typeof input === "object" && input !== null ? input : output;
  }
  if (Array.isArray(output)) {
    if (!Array.isArray(input)) return output;
    return output.map((entry, index) =>
      restoreOpaque(input[index], entry, elementNode(structure, index)),
    );
  }
  if (!isPlainObject(output) || !isPlainObject(input)) return output;
  const declared = new Map(
    structure.props?.map((prop) => [prop.key, prop.value]) ?? [],
  );
  return Object.fromEntries(
    Reflect.ownKeys(output).map((key) => [
      key,
      restoreOpaque(
        (input as Record<PropertyKey, unknown>)[key],
        (output as Record<PropertyKey, unknown>)[key],
        declared.get(key),
      ),
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
