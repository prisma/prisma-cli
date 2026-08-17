// Pure helpers for `bump-cli-engine-version.ts`, kept side-effect-free
// for the unit tests in `bump-cli-engine-version-utils.test.ts`.

const EXACT_ENGINE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parts(version: string): [number, number, number] {
  const match = version.match(EXACT_ENGINE_VERSION);
  if (!match) {
    throw new Error(
      `"${version}" is not an exact X.Y.Z version. The engine's line carries ` +
        "no pre-releases and no ranges (ADR 0004; docs/oss/versioning.md).",
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * The next engine version from the current one and the caller's request:
 * `minor` (the pre-1.0 breaking bump), `patch` (the compatible bump), or
 * an explicit `X.Y.Z` that must move forward — npm versions are
 * immutable, so a repeat or a step backward can never publish.
 */
export function computeNextEngineVersion(
  current: string,
  request: string,
): string {
  const [major, minor, patch] = parts(current);
  if (request === "minor") return `${major}.${minor + 1}.0`;
  if (request === "patch") return `${major}.${minor}.${patch + 1}`;
  const [reqMajor, reqMinor, reqPatch] = parts(request);
  const forward =
    reqMajor > major ||
    (reqMajor === major && reqMinor > minor) ||
    (reqMajor === major && reqMinor === minor && reqPatch > patch);
  if (!forward) {
    throw new Error(
      `"${request}" does not move forward from the current "${current}". ` +
        "npm versions are immutable; pick a later version.",
    );
  }
  return request;
}
