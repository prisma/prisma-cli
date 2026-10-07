import { describe, expect, test } from "vitest";
import { extractStatementFlags } from "../src/execution/statement-flags";

const STATEMENTS = {
  rename: { arity: 1 },
  delete: { arity: 1 },
  move: { arity: 2 },
};

function extracted(argv: readonly string[]) {
  const result = extractStatementFlags(argv, STATEMENTS);
  return result.ok
    ? {
        argv: result.argv,
        values: result.values.map(
          ({ verb, values }) => `${verb} ${values.join(" ")}`,
        ),
      }
    : { error: result.error.message };
}

describe("statement flags come out of argv in the order given", () => {
  test("values of different verbs interleave as written", () => {
    expect(
      extracted([
        "migration",
        "plan",
        "--rename",
        "A:B",
        "--delete",
        "C",
        "--rename=D:E",
        "--json",
      ]),
    ).toEqual({
      argv: ["migration", "plan", "--json"],
      values: ["rename A:B", "delete C", "rename D:E"],
    });
  });

  test("a verb takes its arity in values per occurrence", () => {
    expect(extracted(["--move", "A", "B", "positional"])).toEqual({
      argv: ["positional"],
      values: ["move A B"],
    });
  });

  test("nothing after a bare -- is a flag", () => {
    expect(extracted(["--delete", "Legacy", "--", "--rename", "X:Y"])).toEqual({
      argv: ["--", "--rename", "X:Y"],
      values: ["delete Legacy"],
    });
  });

  test("a value starting with '-' can be written after '='", () => {
    expect(extracted(["--rename=-x"])).toEqual({
      argv: [],
      values: ["rename -x"],
    });
  });

  test("an undeclared flag is left for the parser", () => {
    expect(extracted(["--drop", "Legacy"])).toEqual({
      argv: ["--drop", "Legacy"],
      values: [],
    });
  });
});

describe("a wrong value count is an argument error", () => {
  test.each([
    [["--delete"], "--delete needs a value, and was given 0."],
    [
      ["--delete", "--json"],
      "--delete needs a value, and was given 0. A value that starts with '-' must be written --delete=<value>.",
    ],
    [["--move", "A"], "--move needs 2 values, and was given 1."],
    [["--move", "A", "--json"], "--move needs 2 values, and was given 1."],
    [["--delete", ""], "--delete was given an empty value."],
    [["--delete", "  "], "--delete was given an empty value."],
    [["--delete="], "--delete was given an empty value."],
    [
      ["--delete", "-1"],
      "--delete needs a value, and was given 0. A value that starts with '-' must be written --delete=<value>.",
    ],
  ])("%j", (argv, error) => {
    expect(extracted(argv)).toEqual({ error });
  });
});
