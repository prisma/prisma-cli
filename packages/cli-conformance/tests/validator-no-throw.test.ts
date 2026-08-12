/**
 * Check 2. R10 requires every product's config-section validator to
 * return findings and never throw; the engine turns a throwing
 * validator into CLI.INTERNAL_ERROR at exit 1, so a user's config
 * mistake becomes a CLI crash (see the engine's config.test.ts, "a
 * validator that throws is an engine-boundary bug").
 *
 * Sections are injected as plain values, so nothing here is mocked. The
 * last case runs the real shipped composer validator.
 */

import { describe, expect, test } from "vitest";
import {
  checkValidatorNoThrow,
  HOSTILE_INPUTS,
} from "../src/checks/validator-no-throw";
import type { CheckableSection } from "../src/subjects";
import { sectionsFrom } from "../src/subjects";

/** The engine's ConfigSection satisfies this shape; a literal is enough. */
const asSection = (spec: CheckableSection): CheckableSection => spec;

const ok = () => ({ ok: true as const, value: {}, diagnostics: [] });

const kinds = (findings: readonly { kind: string }[]): string[] =>
  [...new Set(findings.map((f) => f.kind))].sort();

describe("HOSTILE_INPUTS", () => {
  test("carries every case the contract fixes, so a later edit cannot quietly shrink it", () => {
    expect(HOSTILE_INPUTS.map((c) => c.label).sort()).toEqual(
      [
        "a frozen object",
        "a function",
        "a getter that throws",
        "a negative zero",
        "a null prototype object",
        "a populated array",
        "a proxy whose get trap throws",
        "a proxy whose ownKeys trap throws",
        "a self-referencing object",
        "a symbol",
        "an empty array",
        "an empty object",
        "bigint",
        "deeply nested objects",
        "false",
        "known fields with wrong types",
        "nan",
        "null",
        "the empty string",
        "undefined",
        "zero",
      ].sort(),
    );
  });
});

describe("checkValidatorNoThrow", () => {
  test("a validator that throws on everything is one finding listing what provoked it", () => {
    const findings = checkValidatorNoThrow({
      sections: [
        asSection({
          name: "explodes",
          validate: () => {
            throw new Error("kaboom");
          },
        }),
      ],
    });
    expect(kinds(findings)).toEqual(["validator-threw"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.subject).toBe("explodes");
    expect(findings[0]?.summary).toContain("threw");
    expect(findings[0]?.detail).toContain("undefined");
    expect(findings[0]?.detail).toContain("kaboom");
  });

  /**
   * The case the corpus exists for. composer's validator spreads its
   * input inside a try/catch precisely because of it, so a corpus that
   * did not reach here would pass a validator that crashes in the field.
   */
  test("a validator that throws only on a hostile proxy is still reported", () => {
    const findings = checkValidatorNoThrow({
      sections: [
        asSection({
          name: "spreads",
          validate: (raw) => {
            const copy = { ...(raw as object) };
            return { ok: true as const, value: copy, diagnostics: [] };
          },
        }),
      ],
    });
    expect(kinds(findings)).toEqual(["validator-threw"]);
    expect(findings[0]?.detail).toContain("proxy");
  });

  test("a validator returning something that is not a SectionValidation is its own finding", () => {
    const findings = checkValidatorNoThrow({
      sections: [
        asSection({
          name: "wrong-shape",
          // The point of the check is that this can happen, so the
          // deliberate lie has to be written down somewhere.
          validate: () => ({ fine: true }),
        }),
      ],
    });
    expect(kinds(findings)).toEqual(["validator-malformed"]);
    expect(findings[0]?.subject).toBe("wrong-shape");
  });

  test("an ok validation missing its value is malformed", () => {
    expect(
      kinds(
        checkValidatorNoThrow({
          sections: [
            asSection({
              name: "no-value",
              validate: () => ({ ok: true, diagnostics: [] }),
            }),
          ],
        }),
      ),
    ).toEqual(["validator-malformed"]);
  });

  test("a total validator reports nothing", () => {
    expect(
      checkValidatorNoThrow({
        sections: [asSection({ name: "total", validate: ok })],
      }),
    ).toEqual([]);
  });

  /** Anti-vacuity: zero sections is a broken invocation, not a pass. */
  test("no sections at all is a finding", () => {
    expect(kinds(checkValidatorNoThrow({ sections: [] }))).toEqual([
      "no-subjects",
    ]);
  });
});

describe("sectionsFrom", () => {
  test("takes sections from families and from standalone commands alike", () => {
    const fromFamily = asSection({
      name: "family-owned",
      validate: ok,
    });
    const fromCommand = asSection({
      name: "command-owned",
      validate: ok,
    });
    expect(
      sectionsFrom({
        families: [{ configSection: fromFamily }, { configSection: undefined }],
        commands: {
          alone: { needs: { config: fromCommand } },
          none: { needs: {} },
        },
      }).map((s) => s.name),
    ).toEqual(["family-owned", "command-owned"]);
  });

  test("a section declared by both a family and a command is listed once", () => {
    const shared = asSection({ name: "shared", validate: ok });
    expect(
      sectionsFrom({
        families: [{ configSection: shared }],
        commands: { one: { needs: { config: shared } } },
      }),
    ).toHaveLength(1);
  });
});
