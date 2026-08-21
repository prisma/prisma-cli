import { readFile } from "node:fs/promises";

export interface SkillStamp {
  /** The npm package the skill was published in. */
  readonly library: string | null;
  /** The version of that package the skill describes. */
  readonly libraryVersion: string | null;
}

const LINE_BREAK = /\r?\n/;
const QUOTED = /^(["'])(.*)\1$/;

const EMPTY_STAMP: SkillStamp = { library: null, libraryVersion: null };

const FRONTMATTER_KEYS = new Map<string, keyof SkillStamp>([
  ["library", "library"],
  ["library_version", "libraryVersion"],
]);

/**
 * The `library` / `library_version` keys of a SKILL.md's YAML
 * frontmatter. Only scalar `key: value` lines at the top level are
 * read, which is all the stamp ever is; a file without frontmatter, or
 * without those keys, reports nulls rather than failing.
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
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") {
      break;
    }
    const separator = line.indexOf(":");
    if (separator === -1 || line.startsWith(" ") || line.startsWith("\t")) {
      continue;
    }
    const field = FRONTMATTER_KEYS.get(line.slice(0, separator).trim());
    if (field) {
      stamp[field] = unquote(line.slice(separator + 1).trim());
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

function unquote(value: string): string {
  const quoted = QUOTED.exec(value);
  return quoted?.[2] ?? value;
}
