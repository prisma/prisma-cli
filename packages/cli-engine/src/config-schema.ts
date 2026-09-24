import { dirname, isAbsolute, resolve } from "node:path";
import { type ArkErrors, scope, type Type, type } from "arktype";
import type { SectionProvenance } from "./config-merge";
import type { SectionValidation } from "./config-section";
import type { Diagnostic } from "./protocol";

/**
 * The section being validated, published for the duration of one
 * synchronous schema run: its provenance, so the `path` keyword can resolve
 * each value against the file that declared its top-level key, and the
 * values the schema declared references, so the clone keeps them.
 */
let current:
  | {
      readonly name: string;
      readonly provenance: SectionProvenance;
      readonly references: WeakSet<object>;
    }
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

const configScope = scope(
  {
    /**
     * A string relative to the config file that wrote it. Validation turns it
     * into an absolute path against that file's directory; an absolute value
     * passes through unchanged.
     */
    path: type("string").pipe((value, ctx) =>
      resolvePathValue(value, ctx.path),
    ),
  },
  {
    clone: <original extends object>(original: original): original =>
      copyExceptReferences(
        original,
        current?.references,
        new Map(),
      ) as original,
  },
);

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
 * Before arktype applies a morph it clones the value, so resolving a path or
 * applying a default never writes into what the caller passed in. The scope
 * above supplies the clone through arktype's `clone` option: it copies every
 * value except the ones the schema declared with {@link reference}, which
 * reach the command as the config file built them. `seen` carries the copies
 * made so far, so a value that refers back to itself is copied once.
 */
function copyExceptReferences(
  value: unknown,
  references: WeakSet<object> | undefined,
  seen: Map<object, unknown>,
): unknown {
  if (typeof value !== "object" || value === null || references?.has(value)) {
    return value;
  }
  const copied = seen.get(value);
  if (copied !== undefined) {
    return copied;
  }
  if (Array.isArray(value)) {
    const elements: unknown[] = [];
    seen.set(value, elements);
    for (const element of value) {
      elements.push(copyExceptReferences(element, references, seen));
    }
    return elements;
  }
  const copy: Record<PropertyKey, unknown> = Object.create(
    Object.getPrototypeOf(value),
  );
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    copy[key] = copyExceptReferences(
      (value as Record<PropertyKey, unknown>)[key],
      references,
      seen,
    );
  }
  return copy;
}

/**
 * Declares a value the config file constructs, such as a descriptor, a
 * client or any class instance: validation checks it against `schema`, and
 * the command receives the file's own object, never a copy. Every value not
 * declared this way is copied before arktype writes into the section.
 *
 * ```ts
 * const toySchema = configSchema({
 *   target: reference(configSchema({ kind: "'target'", id: "string" })),
 *   "out?": "path",
 * });
 * ```
 *
 * `schema` cannot contain a `path` or a default: resolving one would write
 * into the config file's own object, so such a schema is refused here.
 */
export function reference<S extends ConfigSchema>(schema: S): S {
  if (schema.in.expression !== schema.expression) {
    throw new Error(
      `@prisma/cli-engine: a reference cannot contain a path or a default, because resolving it would write into the config file's own object: ${schema.expression}`,
    );
  }
  return schema.narrow((value) => {
    if (
      (typeof value === "object" && value !== null) ||
      typeof value === "function"
    ) {
      current?.references.add(value);
    }
    return true;
  }) as S;
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
  current = { name, provenance, references: new WeakSet() };
  try {
    const out: unknown = schema(raw === undefined ? {} : raw);
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
