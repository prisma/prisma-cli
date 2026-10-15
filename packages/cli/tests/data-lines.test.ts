/**
 * With no format flag a pipe gets each command's stdout data lines and
 * nothing else, so a command that writes none prints nothing to a pipe.
 * That must be a decision, not an omission: every presentation either
 * writes data lines or uses `noDataLines(reason)` to say why it has none
 * (docs/product/output-conventions.md, Data Lines).
 *
 * The check parses the source of this package and of the engine (whose
 * telemetry commands are mounted here) and finds every `stdout` a
 * presentation defines. A `stdout` that can return an empty array
 * literal, in any form (an arrow, a method, a ternary branch, a cast, a
 * function it names), fails unless it is a `noDataLines` call. It reads
 * the source rather than running each command because running them all
 * would need a fixture per command; per-command tests pin the lines
 * themselves. The Composer and ORM families define their own data lines
 * in their own repositories.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_DIRS = [
  path.resolve(import.meta.dirname, "../src"),
  path.resolve(import.meta.dirname, "../../cli-engine/src"),
];
const SENTENCE = /^[A-Za-z].{10,}\.$/;

interface Finding {
  readonly where: string;
  readonly reason?: string;
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(full);
      }
      return Promise.resolve(entry.name.endsWith(".ts") ? [full] : []);
    }),
  );
  return nested.flat();
}

function withoutWrappers(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function canBeEmptyArray(expression: ts.Expression): boolean {
  const inner = withoutWrappers(expression);
  if (ts.isArrayLiteralExpression(inner)) {
    return inner.elements.length === 0;
  }
  if (ts.isConditionalExpression(inner)) {
    return canBeEmptyArray(inner.whenTrue) || canBeEmptyArray(inner.whenFalse);
  }
  if (ts.isBinaryExpression(inner)) {
    return canBeEmptyArray(inner.right);
  }
  return false;
}

function returnsEmptyArray(fn: ts.SignatureDeclaration): boolean {
  const body = (fn as ts.FunctionLikeDeclarationBase).body;
  if (body === undefined) {
    return false;
  }
  if (!ts.isBlock(body)) {
    return canBeEmptyArray(body);
  }
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      return;
    }
    if (
      ts.isReturnStatement(node) &&
      node.expression !== undefined &&
      canBeEmptyArray(node.expression)
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/** The function an identifier names in the same file, if any. */
function declaredFunction(
  file: ts.SourceFile,
  name: string,
): ts.SignatureDeclaration | undefined {
  let match: ts.SignatureDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      match = node;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined
    ) {
      const initializer = withoutWrappers(node.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        match = initializer;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return match;
}

function noDataLinesCall(
  expression: ts.Expression,
): ts.CallExpression | undefined {
  const inner = withoutWrappers(expression);
  return ts.isCallExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    inner.expression.text === "noDataLines"
    ? inner
    : undefined;
}

/** Every stdout that can return an empty array without saying why, and
 *  every noDataLines reason, in one file. */
function inspect(file: ts.SourceFile, label: string) {
  const silent: Finding[] = [];
  const reasons: Finding[] = [];
  const where = (node: ts.Node): string =>
    `${label}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
  const check = (node: ts.Node, value: ts.Expression | undefined): void => {
    if (value === undefined) {
      return;
    }
    const call = noDataLinesCall(value);
    if (call !== undefined) {
      const [first] = call.arguments;
      reasons.push({
        where: where(node),
        reason:
          first !== undefined && ts.isStringLiteralLike(first)
            ? first.text
            : undefined,
      });
      return;
    }
    const inner = withoutWrappers(value);
    const fn =
      ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)
        ? inner
        : ts.isIdentifier(inner)
          ? declaredFunction(file, inner.text)
          : undefined;
    if (fn !== undefined && returnsEmptyArray(fn)) {
      silent.push({ where: where(node) });
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "stdout"
    ) {
      check(node, node.initializer);
    }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === "stdout") {
      check(node, node.name);
    }
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "stdout" &&
      returnsEmptyArray(node)
    ) {
      silent.push({ where: where(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { silent, reasons };
}

async function inspectSources() {
  const files = (await Promise.all(SOURCE_DIRS.map(sourceFiles))).flat();
  const results = await Promise.all(
    files.map(async (file) => {
      const text = await readFile(file, "utf8");
      const label = path.relative(path.resolve(import.meta.dirname, "../.."), file);
      return inspect(
        ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
        label,
      );
    }),
  );
  return {
    silent: results.flatMap((result) => result.silent),
    reasons: results.flatMap((result) => result.reasons),
  };
}

describe("stdout data lines", () => {
  it("no presentation can write an empty stdout without saying why", async () => {
    const { silent } = await inspectSources();

    expect(
      silent.map((finding) => finding.where),
      "Give each presentation data lines, or write stdout: noDataLines(<why it has none>)",
    ).toEqual([]);
  });

  it("every noDataLines call gives its reason as a sentence", async () => {
    const { reasons } = await inspectSources();
    const unexplained = reasons.filter(
      ({ reason }) => reason === undefined || !SENTENCE.test(reason),
    );

    expect(reasons.length).toBeGreaterThan(0);
    expect(unexplained).toEqual([]);
  });

  it("finds an empty stdout in every form a presentation can write it", () => {
    const forms = [
      "const a = { stdout: () => [] };",
      "const b = { stdout: () => [] as string[] };",
      "const c = { stdout() { return []; } };",
      "const d = { stdout: () => (x ? [x] : []) };",
      "const none = () => [];\nconst e = { stdout: none };",
      "function none2() { return []; }\nconst f = { stdout: none2 };",
    ];
    for (const form of forms) {
      const file = ts.createSourceFile(
        "probe.ts",
        form,
        ts.ScriptTarget.Latest,
        true,
      );
      expect(inspect(file, "probe.ts").silent, form).toHaveLength(1);
    }
    const allowed = ts.createSourceFile(
      "probe.ts",
      'const g = { stdout: noDataLines("A delete has no data."), next: () => [] };',
      ts.ScriptTarget.Latest,
      true,
    );
    expect(inspect(allowed, "probe.ts")).toEqual({
      silent: [],
      reasons: [{ where: "probe.ts:1", reason: "A delete has no data." }],
    });
  });
});
