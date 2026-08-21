import { readFile } from "node:fs/promises";

export interface SkillStamp {
  /** The npm package the skill was published in. */
  readonly library: string | null;
  /** The version of that package the skill describes. */
  readonly libraryVersion: string | null;
}

const LINE_BREAK = /\r?\n/;
const QUOTED = /^(["'])(.*)\1$/;
const INDENTED = /^[ \t]/;

const EMPTY_STAMP: SkillStamp = { library: null, libraryVersion: null };

const METADATA_KEY = "metadata";

const STAMP_KEYS = new Map<string, keyof SkillStamp>([
  ["library", "library"],
  ["library_version", "libraryVersion"],
]);

/**
 * The `library` and `library_version` entries of a SKILL.md's
 * `metadata` map. The Agent Skills spec defines no custom top-level
 * frontmatter keys — extensions live under `metadata`, a map of strings
 * — so the stamp is read there and nowhere else. A file without
 * frontmatter, without a `metadata` map, or without those entries
 * reports nulls rather than failing.
 */
export function parseSkillStamp(source: string): SkillStamp {
  const lines = source.split(LINE_BREAK);
  if (lines[0]?.trim() !== "---") {
    return EMPTY_STAMP;
  }

  const stamp: { library: string | null; libraryVersion: string | null } = {
    library: null,
    libraryVersion: null,
  };
  let inMetadata = false;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") {
      break;
    }
    if (line.trim() === "") {
      continue;
    }
    if (!INDENTED.test(line)) {
      inMetadata = keyOf(line) === METADATA_KEY;
      continue;
    }
    if (!inMetadata) {
      continue;
    }
    const field = STAMP_KEYS.get(keyOf(line) ?? "");
    if (field) {
      stamp[field] = valueAfterKey(line);
    }
  }
  return stamp;
}

export async function readSkillStamp(path: string): Promise<SkillStamp | null> {
  try {
    return parseSkillStamp(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function keyOf(line: string): string | null {
  const separator = line.indexOf(":");
  return separator === -1 ? null : line.slice(0, separator).trim();
}

function valueAfterKey(line: string): string {
  const separator = line.indexOf(":");
  return unquote(line.slice(separator + 1).trim());
}

function unquote(value: string): string {
  const quoted = QUOTED.exec(value);
  return quoted?.[2] ?? value;
}
