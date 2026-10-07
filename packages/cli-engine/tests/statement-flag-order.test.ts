import { describe, expect, test } from "vitest";
import { statementFlagValues } from "../src/execution/shared-flags";

const VERBS = ["rename", "delete", "dropColumn"];

function ordered(argv: readonly string[], parsed: Record<string, unknown>) {
  return statementFlagValues(argv, VERBS, parsed).map(
    ({ verb, text }) => `${verb} ${text}`,
  );
}

describe("verb-flag values keep their argv order across flags", () => {
  test("values of different verbs interleave as written", () => {
    expect(
      ordered(
        [
          "migration",
          "plan",
          "--rename",
          "A:B",
          "--delete",
          "C",
          "--rename=D:E",
        ],
        { rename: ["A:B", "D:E"], delete: ["C"] },
      ),
    ).toEqual(["rename A:B", "delete C", "rename D:E"]);
  });

  test("kebab-case spellings of a camelCase verb count", () => {
    expect(
      ordered(["--drop-column", "User.name", "--delete", "Legacy"], {
        dropColumn: ["User.name"],
        delete: ["Legacy"],
      }),
    ).toEqual(["dropColumn User.name", "delete Legacy"]);
  });

  test("nothing after a bare -- is a flag", () => {
    expect(
      ordered(["--delete", "Legacy", "--", "--rename", "X:Y"], {
        delete: ["Legacy"],
      }),
    ).toEqual(["delete Legacy"]);
  });

  test("every parsed value is kept even when argv cannot place it", () => {
    expect(
      ordered(["--delete=Legacy"], { delete: ["Legacy", "Other"] }),
    ).toEqual(["delete Legacy", "delete Other"]);
  });

  test("every value starts unconsumed", () => {
    expect(
      statementFlagValues(["--delete", "Legacy"], VERBS, {
        delete: ["Legacy"],
      }),
    ).toEqual([{ verb: "delete", text: "Legacy", consumed: false }]);
  });
});
