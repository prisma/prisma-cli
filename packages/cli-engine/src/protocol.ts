/**
 * The protocol types — the shapes that cross package and process
 * boundaries. Types-only consumers import `@prisma/cli-engine/protocol`
 * and drag no engine code.
 */

/**
 * A recorded finding: pure data, never thrown, no stack. Field-for-field
 * the error envelope minus `ok`; the two shapes never diverge.
 * `nextActions` is always present (empty when there are none); the
 * remaining optional fields are wire fields whose absence is data.
 */
export interface Diagnostic {
  readonly code: `${string}.${string}`;
  readonly severity: "error" | "warn" | "info";
  readonly summary: string;
  readonly why?: string;
  readonly nextActions: readonly NextAction[];
  readonly where?: { readonly path?: string; readonly line?: number };
  readonly meta?: Record<string, unknown>;
  readonly docsUrl?: string;
}

/**
 * The typed agent-facing follow-up action.
 */
export interface NextAction {
  readonly kind:
    | "run-command"
    | "open-url"
    | "user-choice"
    | "edit-file"
    | "done";
  readonly label: string;
  readonly command?: string;
  readonly commands?: readonly string[];
  /** The address an `open-url` action sends the user to. A URL is not
   *  a command: putting one in `command` tells a consumer to execute
   *  it. */
  readonly url?: string;
  readonly reason?: string;
}

/**
 * The serialized form of a CliStructuredError.
 */
export type CliErrorEnvelope = { readonly ok: false } & Diagnostic;

function ifDefined<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value !== undefined ? ({ [key]: value } as Partial<Record<K, V>>) : {};
}

/** The mark a structured error carries so it can be recognized without
 *  its prototype. A registry symbol resolves to one symbol across every
 *  copy of this package in an install, so an error built by another copy
 *  carries the same key this one looks for. */
export const STRUCTURED_ERROR: unique symbol = Symbol.for(
  "@prisma/cli-engine.structuredError",
);

/**
 * Structured CLI error carrying everything an error envelope needs.
 * `code` is a dotted `NAMESPACE.SUBCODE` string; the namespace prefix is
 * the error's category.
 */
export class CliStructuredError extends Error {
  readonly [STRUCTURED_ERROR] = true as const;
  readonly code: `${string}.${string}`;
  readonly severity: Diagnostic["severity"];
  readonly why: string | undefined;
  readonly nextActions: readonly NextAction[];
  /** Accompanying findings when the failure had several. This error is
   *  the primary one; these are reported alongside it, so a command can
   *  fail with everything it found instead of only the first thing. */
  readonly diagnostics: readonly Diagnostic[];
  readonly where:
    | { readonly path?: string; readonly line?: number }
    | undefined;
  readonly meta: Record<string, unknown> | undefined;
  readonly docsUrl: string | undefined;

  constructor(
    code: `${string}.${string}`,
    summary: string,
    options?: {
      readonly severity?: Diagnostic["severity"];
      readonly why?: string;
      readonly nextActions?: readonly NextAction[];
      readonly diagnostics?: readonly Diagnostic[];
      readonly where?: { readonly path?: string; readonly line?: number };
      readonly meta?: Record<string, unknown>;
      readonly docsUrl?: string;
      readonly cause?: unknown;
    },
  ) {
    super(
      summary,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "CliStructuredError";
    this.code = code;
    this.severity = options?.severity ?? "error";
    this.why = options?.why;
    this.nextActions = options?.nextActions ?? [];
    this.diagnostics = options?.diagnostics ?? [];
    this.where = options?.where
      ? {
          ...ifDefined("path", options.where.path),
          ...ifDefined("line", options.where.line),
        }
      : undefined;
    this.meta = options?.meta;
    this.docsUrl = options?.docsUrl;
  }

  /**
   * Converts this error to an error envelope for output formatting.
   */
  toEnvelope(): CliErrorEnvelope {
    return {
      ok: false,
      code: this.code,
      severity: this.severity,
      summary: this.message,
      ...ifDefined("why", this.why),
      nextActions: this.nextActions,
      ...ifDefined("where", this.where),
      ...ifDefined("meta", this.meta),
      ...ifDefined("docsUrl", this.docsUrl),
    };
  }

  /**
   * Recognizes a structured error across module boundaries, where
   * instanceof fails because each copy of this package has its own
   * class. The brand answers it outright. The duck-typed check behind
   * it is the fallback for an error from a copy old enough to predate
   * the brand: rejecting those would turn a real failure into an
   * engine-bug report, so it has to keep working.
   *
   * Neither branch asks what the value's prototype is. Nothing in
   * settlement needs an Error — it reads `code` and `nextActions` and
   * calls `toEnvelope` — so a prototype chain, which is local to the
   * copy that made it, is not the thing worth checking.
   */
  static is(error: unknown): error is CliStructuredError {
    if (typeof error !== "object" || error === null) {
      return false;
    }
    const candidate = error as CliStructuredError;
    if (candidate[STRUCTURED_ERROR] === true) {
      return true;
    }
    return (
      candidate.name === "CliStructuredError" &&
      typeof candidate.code === "string" &&
      typeof candidate.toEnvelope === "function"
    );
  }
}

/**
 * A successful result containing a value.
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
  assertOk(): T;
  assertNotOk(): never;
}

/**
 * An unsuccessful result containing failure details.
 */
export interface NotOk<F> {
  readonly ok: false;
  readonly failure: F;
  assertOk(): never;
  assertNotOk(): F;
}

/**
 * A discriminated union representing either success (Ok) or failure
 * (NotOk). The standard way to return expected failures as values
 * rather than throwing.
 */
export type Result<T, F> = Ok<T> | NotOk<F>;

class OkImpl<T> implements Ok<T> {
  readonly ok = true as const;
  readonly value: T;

  constructor(value: T) {
    this.value = value;
    Object.freeze(this);
  }

  assertOk(): T {
    return this.value;
  }

  assertNotOk(): never {
    throw new Error("Expected NotOk result but got Ok");
  }
}

class NotOkImpl<F> implements NotOk<F> {
  readonly ok = false as const;
  readonly failure: F;

  constructor(failure: F) {
    this.failure = failure;
    Object.freeze(this);
  }

  assertOk(): never {
    throw new Error("Expected Ok result but got NotOk");
  }

  assertNotOk(): F {
    return this.failure;
  }
}

/**
 * Creates a successful result.
 */
export function ok<T>(value: T): Ok<T> {
  return new OkImpl(value);
}

/**
 * Creates an unsuccessful result.
 */
export function notOk<F>(failure: F): NotOk<F> {
  return new NotOkImpl(failure);
}

const OK_VOID: Ok<void> = new OkImpl<void>(undefined);

/**
 * Returns the singleton successful void result.
 */
export function okVoid(): Ok<void> {
  return OK_VOID;
}
