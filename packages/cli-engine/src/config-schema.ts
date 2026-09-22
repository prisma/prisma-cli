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
 * Thrown when a section's schema itself is wrong, as opposed to the config
 * file being wrong. It escapes validateSectionWithSchema rather than becoming
 * a diagnostic, so the schema's author sees it instead of the user being told
 * to fix a config file that is fine.
 */
export class ConfigSchemaError extends Error {}

/**
 * What a compiled arktype schema says about one value: the object keys it
 * declares (`props`), the positions of a tuple or list (`sequence`), or an
 * index signature. A schema that says nothing about a value has no shape
 * here, which is what tells the two walks below to leave that value alone.
 */
interface SchemaShape {
  readonly props?: ReadonlyArray<{
    readonly key: PropertyKey;
    readonly value: SchemaNode;
  }>;
  readonly sequence?: {
    readonly prefix?: readonly SchemaNode[];
    readonly optionals?: readonly SchemaNode[];
    readonly postfix?: readonly SchemaNode[];
    readonly element?: SchemaNode;
  };
  readonly index?: readonly unknown[];
}

/** One node of a compiled arktype schema. */
interface SchemaNode {
  readonly structure?: SchemaShape;
  /** The alternatives of a union. */
  readonly branches?: readonly SchemaNode[];
  /** A node that transforms its input keeps what it accepts on its `in` side. */
  readonly in?: SchemaNode;
  /** Whether a pipe or a default applies at or under this node. */
  readonly includesTransform?: boolean;
  readonly allows?: (value: unknown) => boolean;
}

/**
 * The node that applies to `value` here: the node itself, what a
 * transforming node accepts, or the union alternative that matches. Nothing
 * when no alternative matches, which validation is about to report.
 */
function nodeForValue(
  node: SchemaNode | undefined,
  value: unknown,
): SchemaNode | undefined {
  if (node === undefined) return undefined;
  if (node.branches !== undefined && node.branches.length > 1) {
    const match = node.branches.find(
      (branch) => branch.allows?.(value) === true,
    );
    return match === undefined ? undefined : nodeForValue(match, value);
  }
  if (
    node.structure === undefined &&
    node.in !== undefined &&
    node.in !== node
  ) {
    const inner = nodeForValue(node.in, value);
    return inner?.structure === undefined ? node : inner;
  }
  return node;
}

/** The shape `node` gives this value, having already resolved the node. */
function shapeOf(node: SchemaNode | undefined): SchemaShape | undefined {
  const shape = node?.structure;
  if (shape?.index !== undefined && shape.index.length > 0) {
    throw new ConfigSchemaError(
      "@prisma/cli-engine: a config section schema cannot declare an index signature, because the keys it would match are not known ahead of the value; declare the keys, or check the value with a predicate",
    );
  }
  return shape;
}

/**
 * The node for one position of an array: a tuple's own position counting
 * from either end, else the element every remaining entry shares.
 */
function nodeForPosition(
  shape: SchemaShape,
  index: number,
  length: number,
): SchemaNode | undefined {
  const sequence = shape.sequence;
  if (sequence === undefined) return undefined;
  const prefix = sequence.prefix ?? [];
  if (index < prefix.length) return prefix[index];
  const optionals = sequence.optionals ?? [];
  if (index < prefix.length + optionals.length) {
    return optionals[index - prefix.length];
  }
  const postfix = sequence.postfix ?? [];
  const fromEnd = length - index;
  if (fromEnd <= postfix.length) return postfix[postfix.length - fromEnd];
  return sequence.element;
}

/**
 * Copies `value` wherever the schema describes its shape, and no further.
 * arktype applies a default by assigning to the object that holds it, so an
 * object the config file froze has to be copied first. Anything the schema
 * only checks, never describes, is passed through untouched.
 */
function copyWhereDescribed(
  value: unknown,
  node: SchemaNode | undefined,
): unknown {
  const shape = shapeOf(nodeForValue(node, value));
  // No alternative of a union matched: the value is about to fail
  // validation, and copying it one level keeps a frozen object from turning
  // that failure into a write to a read-only property.
  const unmatchedUnion =
    shape === undefined &&
    node?.branches !== undefined &&
    node.branches.length > 1;
  if (shape === undefined && !unmatchedUnion) return value;
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      shape === undefined
        ? entry
        : copyWhereDescribed(
            entry,
            nodeForPosition(shape, index, value.length),
          ),
    );
  }
  if (!isPlainObject(value)) return value;
  const declared = new Map(shape?.props?.map((prop) => [prop.key, prop.value]));
  return Object.fromEntries(
    Reflect.ownKeys(value).map((key) => [
      key,
      copyWhereDescribed(
        (value as Record<PropertyKey, unknown>)[key],
        declared.get(key),
      ),
    ]),
  );
}

/**
 * Whether `output` is arktype's rebuild of `input`, rather than a different
 * value a pipe produced in its place. A rebuild carries the same own keys;
 * a replacement is a different object. Asking this per value is what keeps
 * the walk below from undoing a pipe that returns an object of its own,
 * without having to tell arktype's own rebuild apart from a pipe at the
 * node above (in a compiled schema they look the same).
 */
function isRebuildOf(input: unknown, output: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  if (typeof output !== "object" || output === null) return false;
  if (Array.isArray(input) !== Array.isArray(output)) return false;
  const inputKeys = Reflect.ownKeys(input);
  const outputKeys = new Set(Reflect.ownKeys(output));
  return (
    inputKeys.length === outputKeys.size &&
    inputKeys.every((key) => outputKeys.has(key))
  );
}

/**
 * arktype rebuilds an object whenever a default or a pipe applies anywhere
 * inside it, and the rebuild clones every property, including values the
 * schema only checked. Such a value is something the config file built at
 * runtime: a function closing over module state, a class instance whose
 * methods need their own `this`, a table of codecs. A clone of it is not it.
 * So this walk puts the config file's own value back wherever the schema
 * described no shape and the result is a rebuild of it, which is why a
 * section schema checks such values with a predicate instead of describing
 * them. A value the schema transformed on purpose keeps what the transform
 * produced: a pipe at the value itself, and a pipe further up that returned
 * a different object rather than a rebuild of this one.
 */
function putBackOriginalValues(
  input: unknown,
  output: unknown,
  node: SchemaNode | undefined,
): unknown {
  const applicable = nodeForValue(node, output);
  const shape = shapeOf(applicable);
  if (shape === undefined) {
    if (applicable?.includesTransform === true) return output;
    return isRebuildOf(input, output) ? input : output;
  }
  if (Array.isArray(output)) {
    if (!Array.isArray(input)) return output;
    return output.map((entry, index) =>
      putBackOriginalValues(
        input[index],
        entry,
        nodeForPosition(shape, index, output.length),
      ),
    );
  }
  if (!isPlainObject(output) || !isPlainObject(input)) return output;
  const declared = new Map(shape.props?.map((prop) => [prop.key, prop.value]));
  return Object.fromEntries(
    Reflect.ownKeys(output).map((key) => [
      key,
      putBackOriginalValues(
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
    // arktype applies a default by assigning to the object that holds it,
    // and the merged section arrives frozen, so the described shape is
    // copied first; values the schema only checks keep their identity.
    const node = schema.internal as unknown as SchemaNode;
    const validated: unknown = schema(
      raw === undefined ? {} : copyWhereDescribed(raw, node),
    );
    if (validated instanceof type.errors) {
      return {
        ok: false,
        diagnostics: [...validated].map((error) =>
          fieldDiagnostic(name, error, provenance),
        ),
      };
    }
    const out = putBackOriginalValues(raw, validated, node);
    const nearest = provenance.files[0];
    const value =
      isPlainObject(out) && nearest !== undefined
        ? Object.freeze({ ...out, baseDir: dirname(nearest) })
        : out;
    return { ok: true, value: value as ConfigSchemaValue<S>, diagnostics: [] };
  } catch (cause) {
    // A schema that cannot be walked is its author's bug, not the user's
    // config, so it is never turned into a diagnostic about their file.
    if (cause instanceof ConfigSchemaError) throw cause;
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
