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
 * Outside a section validation there is no file to resolve against, and
 * the value is returned as written. arktype runs a field's morph when a
 * default is declared, at schema definition time, so this branch is what
 * a `path` default takes then; the default is resolved when it is applied.
 */
function resolvePathValue(value: string, path: readonly PropertyKey[]): string {
  if (isAbsolute(value) || current === undefined) {
    return value;
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
 *   greeting: "string = 'hello'",
 * });
 * ```
 */
export const configSchema: typeof configScope.type = configScope.type;

export type ConfigSchema<T = unknown> = Type<T, typeof configScope.t>;

/** The validated value a schema produces: its output type, plus `baseDir` on a plain object. */
export type ConfigSchemaValue<S extends ConfigSchema> = S["infer"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  current = { name, provenance };
  try {
    // arktype applies defaults and morphs onto the objects it is handed, and
    // the merged section value arrives frozen, so it validates a copy.
    const input: unknown = raw === undefined ? {} : copyPlainData(raw);
    const validated: unknown = schema(input);
    if (validated instanceof type.errors) {
      return {
        ok: false,
        diagnostics: [...validated].map((error) =>
          fieldDiagnostic(name, error, provenance),
        ),
      };
    }
    // A `path` default is stored as written when the schema is defined and
    // inserted verbatim, so a second pass over the validated value resolves
    // it; every path already resolved passes through unchanged.
    const out: unknown = schema(validated);
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
    // A nested value the file froze, or a getter that throws when arktype
    // reads it: config-file content, reported as such rather than as a bug.
    return {
      ok: false,
      diagnostics: [unreadableDiagnostic(name, cause, provenance)],
    };
  } finally {
    current = undefined;
  }
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
