// Pure helpers for the tarball install smoke (`tarball-smoke.mjs`).
// Written to S6's check-3b design (specs/s6-conformance.md on the S6
// branch) so the conformance slice can absorb them as a move, not a
// rewrite.

import path from "node:path";

/**
 * npm `overrides` mapping every workspace-package dependency of the
 * subject — transitively — to its packed tarball. Keys are
 * version-qualified (`name@version`) so an override never captures a
 * different release line arriving through some other dependency edge.
 * Computed, not written: a hand-kept list would break silently the
 * first time another private sibling becomes a runtime dependency.
 */
export function computeOverrides(subjectManifest, workspacePackages) {
  const overrides = {};

  function visit(manifest) {
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const entry = workspacePackages.get(name);
      if (!entry) continue;
      const key = `${name}@${entry.manifest.version}`;
      if (key in overrides) continue;
      if (!entry.tarballPath) {
        throw new Error(
          `workspace dependency ${key} was never packed, so the sandbox install cannot resolve it`,
        );
      }
      if (!path.isAbsolute(entry.tarballPath)) {
        throw new Error(
          `tarball path for ${key} must be absolute: a relative path in a nested override resolves against node_modules, not the sandbox root (got ${entry.tarballPath})`,
        );
      }
      overrides[key] = `file:${entry.tarballPath}`;
      visit(entry.manifest);
    }
  }

  visit(subjectManifest);
  return overrides;
}

/** The manifest's bin entries as `{name, path}` pairs, handling the
 *  string shorthand (named after the unscoped package name). */
export function declaredBins(manifest) {
  if (!manifest.bin) return [];
  if (typeof manifest.bin === "string") {
    const name = manifest.name.split("/").pop();
    return [{ name, path: manifest.bin }];
  }
  return Object.entries(manifest.bin).map(([name, binPath]) => ({
    name,
    path: binPath,
  }));
}
