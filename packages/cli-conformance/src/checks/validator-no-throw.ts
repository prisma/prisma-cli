import type { Finding } from "../findings";
import type { CheckableSection } from "../subjects";

/** One hostile value, with a label that names it in a finding. */
export interface HostileInput {
  readonly label: string;
  /** Built per use: some cases are stateful or self-referencing. */
  readonly make: () => unknown;
}

function selfReferencing(): unknown {
  const object: Record<string, unknown> = { name: "loop" };
  object.self = object;
  return object;
}

function throwingProxy(trap: "get" | "ownKeys"): unknown {
  const explode = () => {
    throw new Error(`the ${trap} trap throws`);
  };
  return new Proxy(
    { configPath: "x" },
    trap === "get" ? { get: explode } : { ownKeys: explode },
  );
}

function throwingGetter(): unknown {
  return Object.defineProperty({}, "configPath", {
    enumerable: true,
    get() {
      throw new Error("the getter throws");
    },
  });
}

/**
 * The corpus every shipped validator must survive. Fixed here rather
 * than per product, so one product cannot pass by testing less.
 *
 * "known fields with wrong types" uses a generic spread of plausible
 * config keys: the check cannot know a section's own field names, and a
 * caller who wants section-specific cases passes `extraInputs`.
 */
export const HOSTILE_INPUTS: readonly HostileInput[] = [
  { label: "undefined", make: () => undefined },
  { label: "null", make: () => null },
  { label: "false", make: () => false },
  { label: "zero", make: () => 0 },
  { label: "a negative zero", make: () => -0 },
  { label: "the empty string", make: () => "" },
  { label: "bigint", make: () => 10n },
  { label: "a symbol", make: () => Symbol("hostile") },
  { label: "nan", make: () => Number.NaN },
  { label: "an empty array", make: () => [] },
  { label: "a populated array", make: () => [1, "two", null] },
  { label: "a function", make: () => () => "not config" },
  { label: "an empty object", make: () => ({}) },
  { label: "a frozen object", make: () => Object.freeze({ configPath: "x" }) },
  {
    label: "a null prototype object",
    make: () => Object.assign(Object.create(null), { configPath: "x" }),
  },
  {
    label: "deeply nested objects",
    make: () => ({ a: { b: { c: { d: { e: { f: { g: "deep" } } } } } } }),
  },
  { label: "a self-referencing object", make: selfReferencing },
  {
    label: "known fields with wrong types",
    make: () => ({
      configPath: 42,
      path: [],
      url: {},
      enabled: "yes",
      timeout: "soon",
    }),
  },
  { label: "a proxy whose get trap throws", make: () => throwingProxy("get") },
  {
    label: "a proxy whose ownKeys trap throws",
    make: () => throwingProxy("ownKeys"),
  },
  { label: "a getter that throws", make: throwingGetter },
];

export interface ValidatorNoThrowInput {
  readonly sections: readonly CheckableSection[];
  readonly extraInputs?: readonly HostileInput[];
}

/**
 * Check 2. Every section's shipped validator returns a well-formed
 * SectionValidation for every hostile input, and throws for none.
 */
export function checkValidatorNoThrow(
  input: ValidatorNoThrowInput,
): readonly Finding[] {
  if (input.sections.length === 0) {
    return [
      {
        kind: "no-subjects",
        check: "validator-no-throw",
        subject: "(none)",
        summary:
          "no config sections were supplied, so no validator was checked",
      },
    ];
  }
  const corpus = [...HOSTILE_INPUTS, ...(input.extraInputs ?? [])];
  return input.sections.flatMap((section) => checkOne(section, corpus));
}

function checkOne(
  section: CheckableSection,
  corpus: readonly HostileInput[],
): readonly Finding[] {
  const threw: string[] = [];
  const malformed: string[] = [];
  let firstError: string | undefined;
  for (const hostile of corpus) {
    let returned: unknown;
    try {
      returned = section.validate(hostile.make(), { files: [], keys: {} });
    } catch (error) {
      threw.push(hostile.label);
      firstError ??= error instanceof Error ? error.message : String(error);
      continue;
    }
    if (!isSectionValidation(returned)) malformed.push(hostile.label);
  }
  return [
    ...(threw.length === 0
      ? []
      : [
          finding(
            "validator-threw",
            section.name,
            `validator threw on ${threw.length} of ${corpus.length} hostile inputs; R10 requires it to return findings instead`,
            `provoked by: ${threw.join(", ")}\nfirst error: ${firstError ?? "(none)"}`,
          ),
        ]),
    ...(malformed.length === 0
      ? []
      : [
          finding(
            "validator-malformed",
            section.name,
            `validator returned something that is not a SectionValidation for ${malformed.length} of ${corpus.length} hostile inputs`,
            `provoked by: ${malformed.join(", ")}`,
          ),
        ]),
  ];
}

function finding(
  kind: Finding["kind"],
  subject: string,
  summary: string,
  detail: string,
): Finding {
  return { kind, check: "validator-no-throw", subject, summary, detail };
}

/** `{ ok: true, value, diagnostics }` or `{ ok: false, diagnostics }`. */
function isSectionValidation(returned: unknown): boolean {
  if (typeof returned !== "object" || returned === null) return false;
  const candidate = returned as {
    ok?: unknown;
    value?: unknown;
    diagnostics?: unknown;
  };
  if (!Array.isArray(candidate.diagnostics)) return false;
  if (candidate.ok === false) return true;
  return candidate.ok === true && "value" in candidate;
}
