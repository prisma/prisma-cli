import type { Finding } from "../findings";
import type { BuiltOutput } from "../module-graph";

/** The dependency fields a consumer actually installs. */
export interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

export interface ImportPurityInput {
  /** The package this output belongs to, so a multi-package run stays legible. */
  readonly label: string;
  readonly output: BuiltOutput;
  readonly manifest: PackageManifest;
  /**
   * Private workspace names the output may legitimately reference —
   * a name bundled into this package's own output rather than resolved
   * from the consumer's node_modules.
   */
  readonly allowedPrivate?: readonly string[];
  /**
   * Declared dependencies reached without a static import, so the
   * reverse half must not report them. `import.meta.resolve` is the
   * case: it is not an import, by design.
   */
  readonly allowedUnimported?: readonly string[];
  /**
   * Specifiers that must appear. Without at least one, a run that swept
   * the wrong directory reports nothing and looks like a pass.
   */
  readonly requiredSpecifiers?: readonly string[];
}

/**
 * Check 1. Every bare specifier the built output imports must belong to
 * a package a consumer will have installed, and every declared runtime
 * dependency must be reached.
 */
export function checkImportPurity(
  input: ImportPurityInput,
): readonly Finding[] {
  const finding = (
    kind: Finding["kind"],
    summary: string,
    where?: Finding["where"],
  ): Finding => ({
    kind,
    check: "import-purity",
    subject: input.label,
    summary,
    ...(where === undefined ? {} : { where }),
  });

  if (input.output.files.length === 0) {
    return [
      finding(
        "no-output",
        "no built JavaScript was swept, so nothing was checked — build first",
      ),
    ];
  }

  return [
    ...undeclaredImports(input, finding),
    ...unimportedDependencies(input, finding),
    ...missingRequired(input, finding),
  ];
}

type MakeFinding = (
  kind: Finding["kind"],
  summary: string,
  where?: Finding["where"],
) => Finding;

function installedNames(manifest: PackageManifest): ReadonlySet<string> {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

function undeclaredImports(
  input: ImportPurityInput,
  finding: MakeFinding,
): readonly Finding[] {
  const declared = installedNames(input.manifest);
  const allowed = new Set(input.allowedPrivate ?? []);
  const reported = new Set<string>();
  const findings: Finding[] = [];
  for (const imported of input.output.imports) {
    if (declared.has(imported.root) || allowed.has(imported.root)) continue;
    if (reported.has(imported.specifier)) continue;
    reported.add(imported.specifier);
    findings.push(
      finding(
        "undeclared-import",
        `imports ${imported.specifier}, which the manifest does not declare as a dependency, peer dependency or optional dependency`,
        { path: imported.file },
      ),
    );
  }
  return findings;
}

/** Only `dependencies`: a peer or optional may go unused by design. */
function unimportedDependencies(
  input: ImportPurityInput,
  finding: MakeFinding,
): readonly Finding[] {
  const imported = new Set(input.output.imports.map((entry) => entry.root));
  const excused = new Set(input.allowedUnimported ?? []);
  return Object.keys(input.manifest.dependencies ?? {})
    .filter((name) => !imported.has(name) && !excused.has(name))
    .map((name) =>
      finding(
        "unimported-dependency",
        `declares ${name} as a dependency, but the built output never imports it`,
      ),
    );
}

function missingRequired(
  input: ImportPurityInput,
  finding: MakeFinding,
): readonly Finding[] {
  const seen = new Set(input.output.imports.map((entry) => entry.specifier));
  return (input.requiredSpecifiers ?? [])
    .filter((specifier) => !seen.has(specifier))
    .map((specifier) =>
      finding(
        "missing-required-specifier",
        `does not import ${specifier}, which this check requires — the output swept is not the output expected`,
      ),
    );
}
