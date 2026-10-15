/**
 * With no format flag a pipe gets each command's stdout data lines and
 * nothing else, so a command that writes none prints nothing to a pipe.
 * That must be a decision, not an omission: every presentation this
 * package defines either writes data lines or uses `noDataLines(reason)`
 * to say why it has none (docs/product/output-conventions.md, Data
 * Lines).
 *
 * The check reads the source rather than running each command, because
 * running them all would need a fixture per command. It covers the
 * commands this repository defines. The Composer and ORM families
 * define their own data lines in their own repositories.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_DIR = path.resolve(import.meta.dirname, "../src");
const EMPTY_STDOUT = /stdout:\s*\(\)\s*=>\s*\[\s*\]/;
const NO_DATA_CALL = /noDataLines\(\s*(?:"([^"]*)")?/g;
const SENTENCE = /^[A-Za-z].{10,}\.$/;

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

async function sources(): Promise<Array<{ file: string; text: string }>> {
  const files = await sourceFiles(SOURCE_DIR);
  return Promise.all(
    files.map(async (file) => ({
      file: path.relative(SOURCE_DIR, file),
      text: await readFile(file, "utf8"),
    })),
  );
}

describe("stdout data lines", () => {
  it("no presentation writes an empty stdout without saying why", async () => {
    const silent = (await sources())
      .filter(({ text }) => EMPTY_STDOUT.test(text))
      .map(({ file }) => file);

    expect(
      silent,
      "Give each presentation data lines, or write stdout: noDataLines(<why it has none>)",
    ).toEqual([]);
  });

  it("every noDataLines call gives its reason as a sentence", async () => {
    const reasons = (await sources()).flatMap(({ file, text }) =>
      [...text.matchAll(NO_DATA_CALL)].map((match) => ({
        file,
        reason: match[1],
      })),
    );
    const unexplained = reasons.filter(
      ({ file, reason }) =>
        file !== path.join("output", "data-lines.ts") &&
        (reason === undefined || !SENTENCE.test(reason)),
    );

    expect(reasons.length).toBeGreaterThan(0);
    expect(unexplained).toEqual([]);
  });
});
