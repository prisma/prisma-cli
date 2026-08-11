/**
 * Single-character alias, enforced at the type level: `Char<'q'>` is
 * 'q'; `Char<'ab'>` is never.
 */
export type Char<S extends string> = S extends `${string}${infer Rest}`
  ? Rest extends ""
    ? S
    : never
  : never;

export interface FlagSpec<T> {
  /** Phantom type carrier for inference; never present at runtime. */
  readonly __flag?: T;
}

export interface FlagRuntimeSpec {
  readonly type:
    | "string"
    | "requiredString"
    | "number"
    | "boolean"
    | "enum"
    | "repeated";
  readonly brief: string;
  readonly placeholder: string | undefined;
  readonly alias: string | undefined;
  readonly default: unknown;
  readonly values: readonly string[] | undefined;
}

export function flagRuntime(spec: FlagSpec<unknown>): FlagRuntimeSpec {
  return spec as FlagRuntimeSpec;
}

function brandFlag<T>(spec: {
  readonly type: FlagRuntimeSpec["type"];
  readonly brief: string;
  readonly placeholder?: string;
  readonly alias?: string;
  readonly default?: unknown;
  readonly values?: readonly string[];
}): FlagSpec<T> {
  const runtime: FlagRuntimeSpec = {
    type: spec.type,
    brief: spec.brief,
    placeholder: spec.placeholder,
    alias: spec.alias,
    default: spec.default,
    values: spec.values,
  };
  return Object.freeze(runtime) as FlagSpec<T>;
}

/**
 * Command-declared flags. The shared family (--format/--json,
 * --log-level/--verbose, --quiet, --yes, --interactive, --color) is
 * engine-injected and reserved. Flags are optional by default
 * (requiredString is the exception); positionals are required by
 * default (optionalString is the exception).
 */
export const flag = {
  string<A extends string = never>(spec: {
    brief: string;
    placeholder?: string;
    alias?: A & Char<A>;
    default?: string;
  }): FlagSpec<string | undefined> {
    return brandFlag<string | undefined>({ type: "string", ...spec });
  },
  requiredString<A extends string = never>(spec: {
    brief: string;
    placeholder?: string;
    alias?: A & Char<A>;
  }): FlagSpec<string> {
    return brandFlag<string>({ type: "requiredString", ...spec });
  },
  number<A extends string = never>(spec: {
    brief: string;
    placeholder?: string;
    alias?: A & Char<A>;
    default?: number;
  }): FlagSpec<number | undefined> {
    return brandFlag<number | undefined>({ type: "number", ...spec });
  },
  boolean<A extends string = never>(spec: {
    brief: string;
    alias?: A & Char<A>;
  }): FlagSpec<boolean> {
    return brandFlag<boolean>({ type: "boolean", ...spec });
  },
  enum<const T extends readonly string[], A extends string = never>(spec: {
    brief: string;
    values: T;
    alias?: A & Char<A>;
    default?: T[number];
  }): FlagSpec<T[number] | undefined> {
    return brandFlag<T[number] | undefined>({ type: "enum", ...spec });
  },
  repeated<A extends string = never>(spec: {
    brief: string;
    placeholder?: string;
    alias?: A & Char<A>;
  }): FlagSpec<readonly string[]> {
    return brandFlag<readonly string[]>({ type: "repeated", ...spec });
  },
};

export interface PositionalSpec<T> {
  /** Phantom type carrier for inference; never present at runtime. */
  readonly __positional?: T;
}

export interface PositionalRuntimeSpec {
  readonly type: "string" | "optionalString" | "variadic";
  readonly brief: string;
  readonly placeholder: string;
}

export function positionalRuntime(
  spec: PositionalSpec<unknown>,
): PositionalRuntimeSpec {
  return spec as PositionalRuntimeSpec;
}

function brandPositional<T>(spec: PositionalRuntimeSpec): PositionalSpec<T> {
  return Object.freeze(spec) as PositionalSpec<T>;
}

export const positional = {
  string(spec: { brief: string; placeholder: string }): PositionalSpec<string> {
    return brandPositional<string>({ type: "string", ...spec });
  },
  optionalString(spec: {
    brief: string;
    placeholder: string;
  }): PositionalSpec<string | undefined> {
    return brandPositional<string | undefined>({
      type: "optionalString",
      ...spec,
    });
  },
  /**
   * Zero or more trailing values; at most one, declared last (order =
   * declaration order; keys must not be integer-like).
   */
  variadic(spec: {
    brief: string;
    placeholder: string;
  }): PositionalSpec<readonly string[]> {
    return brandPositional<readonly string[]>({ type: "variadic", ...spec });
  },
};

/** The parse SPI: a command's argument surface, one property. */
export interface ArgsSpec<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
> {
  readonly flags?: TFlags;
  readonly positionals?: TPositionals;
}

/**
 * The normalized argument surface a definition carries: both namespaces
 * always present, empty when the command declares none.
 */
export interface CommandArgs<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
> {
  readonly flags: TFlags;
  readonly positionals: TPositionals;
}

/** The two directions of one rule: a flag key is camelCase in code and
 *  --kebab-case on the CLI. */
export function kebabCase(key: string): string {
  return key.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);
}

export function camelCase(typed: string): string {
  return typed.replace(/-([a-zA-Z0-9])/g, (_, char: string) =>
    char.toUpperCase(),
  );
}

/**
 * What a handler receives: separate namespaces, symmetric access —
 * `args.flags.to`, `args.positionals.name`. Declared flag keys are
 * camelCase and transliterate to --kebab-case on the CLI.
 */
export interface Args<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
> {
  readonly flags: {
    readonly [K in keyof TFlags]: TFlags[K] extends FlagSpec<infer T>
      ? T
      : never;
  };
  readonly positionals: {
    readonly [K in keyof TPositionals]: TPositionals[K] extends PositionalSpec<
      infer T
    >
      ? T
      : never;
  };
}
