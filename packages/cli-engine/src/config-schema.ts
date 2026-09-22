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
      `@prisma/cli-engine: a relative 'path' default must be a thunk so it resolves against the config file when applied: ["path", "=", () => ${JSON.stringify(value)}]`,
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

/** Plain objects and arrays copied; anything else, functions included, by reference. */
function copyPlainData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(copyPlainData);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, copyPlainData(entry)]),
    );
  }
  return value;
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
    // arktype applies defaults and morphs onto the objects it is handed, and
    // the merged section value arrives frozen, so it validates a copy.
    const out: unknown = schema(raw === undefined ? {} : copyPlainData(raw));
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
