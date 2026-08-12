import type { Finding, Suppression } from "../findings";
import { bareImportRoots } from "../module-graph";
import { checkImportPurity, type PackageManifest } from "./import-purity";

/** A packed manifest also names its bins. */
export interface PackedManifest extends PackageManifest {
  readonly version?: string;
  readonly bin?: Readonly<Record<string, string>>;
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
  readonly packages: readonly { name: string; dir: string }[];
  readonly shellPackage: string;
  readonly enginePackage: string;
  /** Command-family packages the shell mounts; must be shell deps. */
  readonly familyPackages: readonly string[];
  readonly exceptions: readonly PinException[];
  readonly sandboxDir: string;
  readonly binTimeoutMs?: number;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Check 3: the tarballs a registry would receive. 3a — packed output
 * imports only what the packed manifest declares. 3b — the root tarball
 * installs into a clean tree and its bins start. 3c — the shell and
 * every family it mounts agree about the engine, measured on manifests
 * and again as copies in the installed tree.
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
      ...(await packedImportPurity(pkg.name, result.tarball, manifest, io)),
    );
  }

  const shell = packed.get(input.shellPackage);
  if (shell === undefined) return findings;

  findings.push(...manifestPinFindings(input, shell.manifest));
  findings.push(...(await sandboxFindings(input, shell, packed, io)));
  return applyExceptions(findings, input.exceptions);
}

/** 3a: check 1 over the tarball's own files and manifest. */
async function packedImportPurity(
  name: string,
  tarball: string,
  manifest: PackedManifest,
  io: TarballIo,
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

/** 3b + 3c's installed legs, all downstream of one sandbox install. */
async function sandboxFindings(
  input: TarballInput,
  shell: { tarball: string; manifest: PackedManifest },
  packed: ReadonlyMap<string, { tarball: string; manifest: PackedManifest }>,
  io: TarballIo,
): Promise<readonly Finding[]> {
  const overrides: Record<string, string> = {};
  for (const [name, pack] of packed) {
    if (name === input.shellPackage) continue;
    const declared = shell.manifest.dependencies?.[name];
    if (declared === undefined) continue;
    overrides[`${name}@${declared}`] = `file:${pack.tarball}`;
  }
  const install = await io.installSandbox({
    sandboxDir: input.sandboxDir,
    rootTarball: shell.tarball,
    overrides,
  });
  if (!install.ok) {
    return [
      finding(
        "install-failed",
        input.shellPackage,
        "the packed tarball did not install into a clean tree",
        install.output,
      ),
    ];
  }
  return [
    ...(await binFindings(input, shell.manifest, io)),
    ...(await installedPinFindings(input, shell.manifest, io)),
  ];
}

async function binFindings(
  input: TarballInput,
  shellManifest: PackedManifest,
  io: TarballIo,
): Promise<readonly Finding[]> {
  const findings: Finding[] = [];
  for (const [binName, relPath] of Object.entries(shellManifest.bin ?? {})) {
    // biome-ignore lint/performance/noAwaitInLoops: bins start one at a time so a failure names its bin and concurrent processes cannot confound each other's exit
    const run = await io.startBin({
      sandboxDir: input.sandboxDir,
      binName,
      relPath,
      argv: ["--version"],
      timeoutMs: input.binTimeoutMs ?? 30_000,
    });
    if (run.timedOut) {
      findings.push(
        finding(
          "bin-failed",
          input.shellPackage,
          `bin ${binName} timed out instead of exiting`,
          run.stderr,
        ),
      );
    } else if (run.exitCode !== 0) {
      findings.push(
        finding(
          "bin-failed",
          input.shellPackage,
          `bin ${binName} exited ${run.exitCode} on plain node`,
          `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
        ),
      );
    }
  }
  return findings;
}

async function installedPinFindings(
  input: TarballInput,
  shellManifest: PackedManifest,
  io: TarballIo,
): Promise<readonly Finding[]> {
  const findings: Finding[] = [];
  const shellPin = shellManifest.dependencies?.[input.enginePackage];

  for (const family of input.familyPackages) {
    const declared = shellManifest.dependencies?.[family];
    // biome-ignore lint/performance/noAwaitInLoops: one manifest read per mounted family — one today — keeps findings ordered with the family list
    const installed = await io.readInstalledManifest(input.sandboxDir, family);
    if (installed === undefined) continue;
    if (declared !== undefined && installed.version !== declared) {
      findings.push(
        finding(
          "engine-pin-mismatch",
          family,
          `the shell declares ${family}@${declared} but ${installed.version ?? "an unknown version"} is installed`,
        ),
      );
    }
    const familyPin = installed.dependencies?.[input.enginePackage];
    if (
      familyPin !== undefined &&
      shellPin !== undefined &&
      familyPin !== shellPin
    ) {
      findings.push(
        finding(
          "engine-pin-mismatch",
          family,
          `${family} pins ${input.enginePackage}@${familyPin} while the shell ships ${shellPin} — an install resolves two engines`,
        ),
      );
    }
  }

  const copies = await io.listInstalledCopies(
    input.sandboxDir,
    input.enginePackage,
  );
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
