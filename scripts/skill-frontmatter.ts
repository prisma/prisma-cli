// Pure helpers for the `metadata.library` / `metadata.library_version`
// frontmatter keys that tie a skill to the npm package it describes.
//
// The skill ships inside the `prisma` tarball, so the version a reader
// sees must be the version they installed. `set-version.ts` stamps
// `library_version` from the same root version it writes into every
// package.json, and `check-skill-packaging.mjs` re-reads it out of the
// packed tarball. Both go through here so there is one definition of
// what the frontmatter looks like.
//
// Under `metadata:` rather than at the top level because the Agent
// Skills spec (agentskills.io) defines the top-level key set and
// reserves `metadata` — a string→string map — for exactly this kind of
// publisher extension. A top-level `library:` would be an undefined key
// that a strict runtime is entitled to reject.

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

/** The `metadata:` mapping: the key line plus the indented block under it. */
const METADATA_SECTION = /^metadata:[ \t]*\r?\n((?:[ \t]+\S.*(?:\r?\n|$))*)/m;

const LEADING_INDENT = /^[ \t]+/;

function keyPattern(key: string): RegExp {
  return new RegExp(`^[ \\t]+${key}:[ \\t]*(.*)$`, "m");
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (
    (quote === '"' || quote === "'") &&
    trimmed.endsWith(quote) &&
    trimmed.length >= 2
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export interface SkillFrontmatter {
  /** The npm package the skill ships inside, e.g. `prisma`. */
  library?: string;
  /** The version of that package, stamped at release time. */
  libraryVersion?: string;
}

/** The indented body of the frontmatter's `metadata:` map, if it has one. */
function metadataBlock(source: string): string | undefined {
  const frontmatter = FRONTMATTER_BLOCK.exec(source)?.[1];
  if (frontmatter === undefined) return undefined;
  return METADATA_SECTION.exec(frontmatter)?.[1];
}

/** Read the version-stamp keys out of a `SKILL.md`. Absent keys stay undefined. */
export function readSkillFrontmatter(source: string): SkillFrontmatter {
  const metadata = metadataBlock(source);
  if (metadata === undefined) return {};

  const library = keyPattern("library").exec(metadata)?.[1];
  const libraryVersion = keyPattern("library_version").exec(metadata)?.[1];
  return {
    library: library === undefined ? undefined : unquote(library),
    libraryVersion:
      libraryVersion === undefined ? undefined : unquote(libraryVersion),
  };
}

/**
 * Rewrite `metadata.library_version` in a `SKILL.md` to `version`. Idempotent.
 *
 * Both keys must already be present. Adding them is an authoring decision —
 * a skill that ships in a tarball declares which package it ships in — and
 * silently inserting them here would let a skill with no `library` key be
 * stamped with a version that means nothing.
 */
export function stampSkillVersion(source: string, version: string): string {
  if (FRONTMATTER_BLOCK.exec(source)?.[1] === undefined) {
    throw new Error("SKILL.md has no YAML frontmatter block.");
  }
  const metadata = metadataBlock(source);
  if (metadata === undefined) {
    throw new Error(
      "SKILL.md frontmatter has no `metadata` map — the version stamp lives there, because the Agent Skills spec reserves `metadata` for publisher keys and defines the top-level ones.",
    );
  }
  const { library, libraryVersion } = readSkillFrontmatter(source);
  if (library === undefined) {
    throw new Error(
      "SKILL.md frontmatter has no `metadata.library` key — a skill that ships inside a tarball must name the package it ships in.",
    );
  }
  if (libraryVersion === undefined) {
    throw new Error(
      "SKILL.md frontmatter has no `metadata.library_version` key — add it (any string) so the release pipeline can stamp it.",
    );
  }

  // Function replacements throughout: the skill body and its long
  // `description` are prose, and a literal `$&` or `$1` in them would be
  // expanded as a capture reference by the string form. The version is
  // quoted because `metadata` is a string→string map.
  const stamped = metadata.replace(
    keyPattern("library_version"),
    (line) =>
      `${LEADING_INDENT.exec(line)?.[0] ?? "  "}library_version: "${version}"`,
  );
  return source.replace(metadata, () => stamped);
}
