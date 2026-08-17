import type { Finding } from "../findings";
import type { PackageManifest } from "./import-purity";

export type PublishChannel = "release" | "dev";

/** Only what this check reads, so `tarball.ts` can call it without a cycle. */
export interface NamedManifest extends PackageManifest {
  readonly name?: string;
}

export interface ReleasePinsInput {
  /** Manifests as a registry would receive them, already packed. */
  readonly manifests: readonly NamedManifest[];
  readonly channel: PublishChannel;
}

/**
 * Everything after the patch number in a version or a range:
 * `1.2.3-dev.4` and `>=1.0.0-dev.1 <1.1.0` both yield `dev.4`-shaped
 * text to inspect.
 */
const PRE_RELEASE = /\d+\.\d+\.\d+-([0-9A-Za-z.-]+)/g;

/**
 * `dev` must stand alone between separators: the dev channel stamps
 * `-dev.<run>` onto a base version, so an RC line reads
 * `8.0.0-rc.1-dev.40` — hyphens separate as much as dots do. Splitting
 * on both keeps `1.0.0-development.1` a release.
 */
const SEPARATORS = /[.-]/;

/** The fields a consumer's install resolves. devDependencies are not. */
const INSTALLED_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

function isDevBuild(specifier: string): boolean {
  for (const match of specifier.matchAll(PRE_RELEASE)) {
    if ((match[1] ?? "").split(SEPARATORS).includes("dev")) return true;
  }
  return false;
}

/**
 * Check 4: a release ships no dev builds. The dev channel exists so the
 * CLI can track the products' newest code, and a dev CLI depending on
 * dev families is the point of it; a release depending on them is a
 * version nobody can reproduce and nobody reviewed (operator ruling
 * 2026-08-17). There is no exception mechanism — a suppressed finding
 * exits 0, which is how `prisma@8.0.0-rc.3` shipped two of them.
 */
export function checkReleasePins(input: ReleasePinsInput): readonly Finding[] {
  if (input.manifests.length === 0) {
    return [
      {
        kind: "no-subjects",
        check: "release-pins",
        subject: "(none)",
        summary: "no manifests were supplied, so no pin was measured",
      },
    ];
  }
  if (input.channel === "dev") return [];

  const findings: Finding[] = [];
  for (const manifest of input.manifests) {
    const owner = manifest.name ?? "(unnamed package)";
    for (const field of INSTALLED_FIELDS) {
      for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
        if (!isDevBuild(specifier)) continue;
        findings.push({
          kind: "dev-build-in-release",
          check: "release-pins",
          subject: name,
          summary: `${owner} publishes a release that depends on ${name}@${specifier}, a dev build — a release depends only on released versions`,
          where: { path: `${field}.${name}` },
        });
      }
    }
  }
  return findings;
}
