import { join } from "node:path";
import type { Finding, Suppression } from "../findings";
import { bareImportRoots } from "../module-graph";
import { checkImportPurity, type PackageManifest } from "./import-purity";
import { checkReleasePins, type PublishChannel } from "./release-pins";

/** A packed manifest also names its bins. */
export interface PackedManifest extends PackageManifest {
  readonly name?: string;
  readonly version?: string;
  /** npm's object form, or the string shorthand named after the package. */
  readonly bin?: Readonly<Record<string, string>> | string;
}

/** Bin entries as name → path, expanding the string shorthand. */
export function declaredBins(
  manifest: PackedManifest,
): readonly [string, string][] {
  if (manifest.bin === undefined) return [];
  if (typeof manifest.bin === "string") {
    const name = manifest.name?.split("/").at(-1) ?? "bin";
    return [[name, manifest.bin]];
  }
  return Object.entries(manifest.bin);
}

/**
 * Every slow or environment-touching operation, injected. The real
 * implementation packs with pnpm (npm pack would leave `workspace:`
 * specifiers unrewritten), installs with
 * `npm install --no-audit --no-fund --ignore-scripts`, and starts bins
 * with plain node under a timeout.
 */
export interface TarballIo {
  pack(
    pkgDir: string,
    destDir?: string,
  ): Promise<{ tarball: string } | { failed: string }>;
  readPackedManifest(tarball: string): Promise<PackedManifest>;
  /** Path → source, `.js`/`.mjs` only, so 3a reuses check 1 unchanged. */
  readPackedFiles(tarball: string): Promise<ReadonlyMap<string, string>>;
  installSandbox(input: {
    readonly sandboxDir: string;
    readonly rootTarball: string;
    /** Version-qualified name → absolute `file:` tarball path. */
    readonly overrides: Readonly<Record<string, string>>;
  }): Promise<{ ok: true } | { ok: false; output: string }>;
  readInstalledManifest(
    sandboxDir: string,
    name: string,
  ): Promise<PackedManifest | undefined>;
  /** Every copy of `name` anywhere in the sandbox's node_modules. */
  listInstalledCopies(
    sandboxDir: string,
    name: string,
  ): Promise<readonly { version: string; path: string }[]>;
  startBin(input: {
    readonly sandboxDir: string;
    readonly binName: string;
    readonly relPath: string;
    readonly argv: readonly string[];
    readonly timeoutMs: number;
  }): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>;
}

/**
 * A known pin mismatch, allowed for now by recorded decision. Keyed on
 * the full observed triple so the same family arriving at any OTHER
 * version reopens the finding instead of staying suppressed.
 */
export interface PinException extends Suppression {
  readonly familyPackage: string;
  readonly familyPin: string;
  readonly shellPin: string;
}

export interface TarballInput {
  readonly packages: readonly {
    name: string;
    dir: string;
    /**
     * Declared dependencies this package reaches without a static
     * import (`import.meta.resolve` and friends), handed through to
     * check 3a's import purity over the packed files.
     */
    allowedUnimported?: readonly string[];
  }[];
  readonly shellPackage: string;
  readonly enginePackage: string;
  /** Command-family packages the shell mounts; must be shell deps. */
  readonly familyPackages: readonly string[];
  readonly exceptions: readonly PinException[];
  readonly sandboxDir: string;
  readonly binTimeoutMs?: number;
  /**
   * Which channel these tarballs are for. Check 4 measures the packed
   * manifests against it; a dev publish is allowed its dev builds.
   */
  readonly channel: PublishChannel;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Package-name characters that cannot appear in a directory name. */
const SANDBOX_NAME_UNSAFE = /[@/]/g;
const LEADING_DASH = /^-/;

/**
 * Check 3: the tarballs a registry would receive. 3a — packed output
 * imports only what the packed manifest declares. 3b — the root tarball
 * installs into a clean tree and its bins start. 3c — the shell and
 * every family it mounts agree about the engine, measured on manifests
 * and again as copies in the installed tree. Check 4 rides along on the
 * same packed manifests: a release depends on no dev build.
 */
export async function checkTarball(
  input: TarballInput,
  io: TarballIo,
): Promise<readonly Finding[]> {
  if (input.packages.length === 0) {
    return [
      finding("no-subjects", "(none)", "no packages were supplied to pack"),
    ];
  }
  const findings: Finding[] = [];
  const packed = new Map<
    string,
    { tarball: string; manifest: PackedManifest }
  >();

  for (const pkg of input.packages) {
    // biome-ignore lint/performance/noAwaitInLoops: packing is sequential by design — each prepack rebuilds shared dist directories, so concurrent packs corrupt each other's input
    const result = await io.pack(pkg.dir);
    if ("failed" in result) {
      findings.push(
        finding("pack-failed", pkg.name, "packing failed", result.failed),
      );
      continue;
    }
    const manifest = await io.readPackedManifest(result.tarball);
    packed.set(pkg.name, { tarball: result.tarball, manifest });
    findings.push(
      ...(await packedImportPurity(
        pkg.name,
        result.tarball,
        manifest,
        io,
        pkg.allowedUnimported,
      )),
    );
  }

  findings.push(
    ...checkReleasePins({
      manifests: [...packed.values()].map((entry) => entry.manifest),
      channel: input.channel,
    }),
  );
  findings.push(...enginePinAgreementFindings(input, packed));

  const shell = packed.get(input.shellPackage);
  if (shell === undefined) return findings;

  findings.push(...siblingPinAgreementFindings(input, shell.manifest, packed));
  findings.push(...manifestPinFindings(input, shell.manifest));
  // Every packed package that declares a bin installs into its OWN
  // sandbox and starts there, so resolution happens the way that
  // package's real install resolves it. prisma@8.0.0-rc.8 shipped a
  // wrapper bin that crashed on every invocation while a shell-only
  // sandbox stayed green: the wrapper's stale product pin was hoisted
  // away by the shell's correct one.
  for (const [name, entry] of packed) {
    if (declaredBins(entry.manifest).length === 0) continue;
    // biome-ignore lint/performance/noAwaitInLoops: sandboxes install one at a time so a failure names its package and concurrent npm installs cannot confound each other
    findings.push(...(await sandboxFindings(input, name, entry, packed, io)));
  }
  return applyExceptions(findings, input.exceptions);
}

/**
 * The rc.8 guard: sibling packages that ship the same bundled source —
 * the shell and the `prisma` wrapper — hand-carry their dependency
 * lists in separate manifests, and which copy of a dependency a user's
 * install resolves depends on hoisting. Any dependency name two packed
 * manifests share must therefore carry the identical specifier.
 */
function siblingPinAgreementFindings(
  input: TarballInput,
  shellManifest: PackedManifest,
  packed: ReadonlyMap<string, { tarball: string; manifest: PackedManifest }>,
): readonly Finding[] {
  const findings: Finding[] = [];
  const shellDeps = shellManifest.dependencies ?? {};
  for (const [name, entry] of packed) {
    if (name === input.shellPackage) continue;
    for (const [dep, specifier] of Object.entries(
      entry.manifest.dependencies ?? {},
    )) {
      const shellSpecifier = shellDeps[dep];
      if (shellSpecifier === undefined || shellSpecifier === specifier) {
        continue;
      }
      findings.push(
        finding(
          "sibling-pin-mismatch",
          name,
          `${name} pins ${dep}@${specifier} while ${input.shellPackage} pins ${shellSpecifier} — which one an install resolves depends on hoisting`,
        ),
      );
    }
  }
  return findings;
}

/**
 * 3c, sibling leg: every packed manifest that depends on the engine
 * must pin exactly the engine version packed beside it. This is how
 * `prisma@8.0.0-rc.4` crashed on import: the engine moved to 0.2.0
 * while `packages/prisma` kept pinning 0.1.1, so the published package
 * resolved a registry engine missing the exports it was built against.
 */
function enginePinAgreementFindings(
  input: TarballInput,
  packed: ReadonlyMap<string, { tarball: string; manifest: PackedManifest }>,
): readonly Finding[] {
  const engineVersion = packed.get(input.enginePackage)?.manifest.version;
  if (engineVersion === undefined) return [];
  const findings: Finding[] = [];
  for (const [name, entry] of packed) {
    if (name === input.enginePackage) continue;
    const pin = entry.manifest.dependencies?.[input.enginePackage];
    if (pin === undefined || pin === engineVersion) continue;
    findings.push(
      finding(
        "engine-pin-mismatch",
        name,
        `${name} pins ${input.enginePackage}@${pin} while this release packs ${input.enginePackage}@${engineVersion} — the published package would resolve a different engine than the one shipping`,
      ),
    );
  }
  return findings;
}

/** 3a: check 1 over the tarball's own files and manifest. */
async function packedImportPurity(
  name: string,
  tarball: string,
  manifest: PackedManifest,
  io: TarballIo,
  allowedUnimported?: readonly string[],
): Promise<readonly Finding[]> {
  const files = await io.readPackedFiles(tarball);
  const imports = [];
  for (const [path, source] of files) {
    // biome-ignore lint/performance/noAwaitInLoops: the lexer's init settles once; after that each parse is synchronous, so there is nothing to overlap
    imports.push(...(await bareImportRoots(source, path)));
  }
  return checkImportPurity({
    label: name,
    output: { files: [...files.keys()], imports },
    manifest,
    ...(allowedUnimported === undefined ? {} : { allowedUnimported }),
  });
}

/** 3c, manifest leg: exact pin, families present, pins agree. */
function manifestPinFindings(
  input: TarballInput,
  shellManifest: PackedManifest,
): readonly Finding[] {
  const findings: Finding[] = [];
  const deps = shellManifest.dependencies ?? {};
  const shellPin = deps[input.enginePackage];

  if (shellPin !== undefined && !EXACT_VERSION.test(shellPin)) {
    findings.push(
      finding(
        "engine-pin-mismatch",
        input.shellPackage,
        `the packed manifest pins ${input.enginePackage} as "${shellPin}", which is not an exact version — a workspace: or range specifier survived packing`,
      ),
    );
  }
  for (const family of input.familyPackages) {
    if (deps[family] === undefined) {
      findings.push(
        finding(
          "no-subjects",
          family,
          `${family} is named as a mounted command family but is not in the shell's packed dependencies — the family list has drifted from the shell`,
        ),
      );
    }
  }
  return findings;
}

/** 3b + 3c's installed legs, one sandbox per bin-bearing package. */
async function sandboxFindings(
  input: TarballInput,
  packageName: string,
  root: { tarball: string; manifest: PackedManifest },
  packed: ReadonlyMap<string, { tarball: string; manifest: PackedManifest }>,
  io: TarballIo,
): Promise<readonly Finding[]> {
  const sandboxDir = join(
    input.sandboxDir,
    packageName.replace(SANDBOX_NAME_UNSAFE, "-").replace(LEADING_DASH, ""),
  );
  // Transitive: a sibling reached only through another sibling still
  // needs its override, or the install falls back to the registry.
  const overrides: Record<string, string> = {};
  const visit = (manifest: PackedManifest): void => {
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const entry = packed.get(name);
      if (entry === undefined) continue;
      const key = `${name}@${entry.manifest.version ?? ""}`;
      if (key in overrides) continue;
      overrides[key] = `file:${entry.tarball}`;
      visit(entry.manifest);
    }
  };
  visit(root.manifest);
  const install = await io.installSandbox({
    sandboxDir,
    rootTarball: root.tarball,
    overrides,
  });
  if (!install.ok) {
    return [
      finding(
        "install-failed",
        packageName,
        "the packed tarball did not install into a clean tree",
        install.output,
      ),
    ];
  }
  return [
    ...(await binFindings(input, packageName, sandboxDir, root.manifest, io)),
    ...(await installedPinFindings(input, sandboxDir, root.manifest, io)),
  ];
}

async function binFindings(
  input: TarballInput,
  packageName: string,
  sandboxDir: string,
  manifest: PackedManifest,
  io: TarballIo,
): Promise<readonly Finding[]> {
  const findings: Finding[] = [];
  for (const [binName, relPath] of declaredBins(manifest)) {
    // biome-ignore lint/performance/noAwaitInLoops: bins start one at a time so a failure names its bin and concurrent processes cannot confound each other's exit
    const run = await io.startBin({
      sandboxDir,
      binName,
      relPath,
      argv: ["--version"],
      timeoutMs: input.binTimeoutMs ?? 30_000,
    });
    if (run.timedOut) {
      findings.push(
        finding(
          "bin-failed",
          packageName,
          `bin ${binName} timed out instead of exiting`,
          run.stderr,
        ),
      );
    } else if (run.exitCode !== 0) {
      findings.push(
        finding(
          "bin-failed",
          packageName,
          `bin ${binName} exited ${run.exitCode} on plain node`,
          `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
        ),
      );
    }
  }
  return findings;
}

/** 3c for one mounted family, once its installed manifest is in hand. */
function familyPinFindings(
  input: TarballInput,
  family: string,
  declared: string | undefined,
  installed: PackedManifest,
  shellPin: string | undefined,
): readonly Finding[] {
  const findings: Finding[] = [];
  if (declared !== undefined && installed.version !== declared) {
    findings.push(
      finding(
        "engine-pin-mismatch",
        family,
        `the shell declares ${family}@${declared} but ${installed.version ?? "an unknown version"} is installed`,
      ),
    );
  }
  // A family declares the engine as an exact peer (ADR 0004); the older
  // shape, a regular dependency, is read too so a family that has not
  // moved yet is still measured rather than skipped.
  const peer = installed.peerDependencies?.[input.enginePackage];
  const familyPin = peer ?? installed.dependencies?.[input.enginePackage];
  if (
    familyPin === undefined ||
    shellPin === undefined ||
    familyPin === shellPin
  ) {
    return findings;
  }
  const verb = peer === undefined ? "pins" : "peers";
  const consequence =
    peer === undefined
      ? "an install resolves two engines"
      : "the family did not build against the engine it will be given";
  findings.push(
    finding(
      "engine-pin-mismatch",
      family,
      `${family} ${verb} ${input.enginePackage}@${familyPin} while the shell ships ${shellPin} — ${consequence}`,
    ),
  );
  return findings;
}

async function installedPinFindings(
  input: TarballInput,
  sandboxDir: string,
  manifest: PackedManifest,
  io: TarballIo,
): Promise<readonly Finding[]> {
  const findings: Finding[] = [];
  const shellPin = manifest.dependencies?.[input.enginePackage];

  for (const family of input.familyPackages) {
    // biome-ignore lint/performance/noAwaitInLoops: one manifest read per mounted family — two today — keeps findings ordered with the family list
    const installed = await io.readInstalledManifest(sandboxDir, family);
    if (installed === undefined) continue;
    findings.push(
      ...familyPinFindings(
        input,
        family,
        manifest.dependencies?.[family],
        installed,
        shellPin,
      ),
    );
  }

  const copies = await io.listInstalledCopies(sandboxDir, input.enginePackage);
  if (copies.length > 1) {
    findings.push(
      finding(
        "engine-pin-mismatch",
        input.enginePackage,
        `${copies.length} copies of ${input.enginePackage} resolve in the installed tree (${copies.map((c) => c.version).join(", ")})`,
        copies.map((c) => `${c.version}  ${c.path}`).join("\n"),
      ),
    );
  }
  return findings;
}

/**
 * A mismatch covered by a recorded exception is suppressed but still
 * printed. Every pin finding in a run whose observed shell and family
 * pins match the exception's triple is covered; anything else fails.
 */
function applyExceptions(
  findings: readonly Finding[],
  exceptions: readonly PinException[],
): readonly Finding[] {
  if (exceptions.length === 0) return findings;
  return findings.map((entry) => {
    if (entry.kind !== "engine-pin-mismatch") return entry;
    const covering = exceptions.find(
      (exception) =>
        entry.summary.includes(exception.familyPin) &&
        entry.summary.includes(exception.shellPin) &&
        (entry.subject === exception.familyPackage ||
          entry.summary.includes(exception.familyPackage) ||
          entry.detail?.includes(exception.familyPin) === true),
    );
    if (covering === undefined) return entry;
    return {
      ...entry,
      suppressedBy: {
        reason: covering.reason,
        removeWhen: covering.removeWhen,
      },
    };
  });
}

function finding(
  kind: Finding["kind"],
  subject: string,
  summary: string,
  detail?: string,
): Finding {
  return {
    kind,
    check: "tarball",
    subject,
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}
