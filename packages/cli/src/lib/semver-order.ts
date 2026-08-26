/**
 * Ordering for the version strings the CLI compares: the installed CLI
 * against the registry's latest, and one workspace member's pin of a
 * skill-bearing package against another's. Only the shape npm publishes
 * is understood; anything else compares as null so the caller can treat
 * it as "cannot tell" rather than as older or newer.
 */

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  };
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const NUMERIC_PART = /^\d+$/;

/** Negative when left is older, positive when newer, 0 when equal, and
 *  null when either side is not a version this understands. */
export function compareVersionStrings(
  left: string,
  right: string,
): number | null {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);

  if (!parsedLeft || !parsedRight) {
    return null;
  }

  return compareVersions(parsedLeft, parsedRight);
}

export function compareVersions(
  left: ParsedVersion,
  right: ParsedVersion,
): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const diff = left[key] - right[key];
    if (diff !== 0) {
      return diff;
    }
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const diff = comparePrereleasePart(leftPart, rightPart);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function comparePrereleasePart(left: string, right: string): number {
  const leftNumber = NUMERIC_PART.test(left) ? Number(left) : null;
  const rightNumber = NUMERIC_PART.test(right) ? Number(right) : null;

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }

  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;

  return left.localeCompare(right);
}
