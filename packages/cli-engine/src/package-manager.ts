import { detect, getUserAgent } from "package-manager-detector/detect";

/** The package managers the engine knows how to drive. */
export type PackageManagerId = "npm" | "pnpm" | "yarn" | "bun" | "deno";

/**
 * One package-manager invocation: the pieces needed to spawn it, plus
 * the exact line to show the user.
 */
export interface PackageManagerCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly line: string;
}

const MANAGERS: ReadonlySet<string> = new Set<PackageManagerId>([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "deno",
]);

function isManager(name: string): name is PackageManagerId {
  return MANAGERS.has(name);
}

/**
 * Resolves the manager to drive at `cwd`. In order: the caller's
 * choice, the host's, the project the library detects by walking up
 * from `cwd`, the manager that invoked this process, then npm. Always
 * resolves — "we could not tell" is not an outcome.
 *
 * Two inherited behaviors of package-manager-detector, deliberate and
 * documented so they are not rediscovered as bugs: the walk goes to the
 * filesystem root with no project boundary, so a lockfile above the
 * project counts; and within one directory a package.json
 * `packageManager` field beats a lockfile.
 */
export async function resolvePackageManager(request: {
  readonly cwd: string;
  /** The caller's explicit choice. */
  readonly override?: PackageManagerId;
  /** What the host declared on `Runtime.packageManager`. */
  readonly host?: PackageManagerId;
}): Promise<PackageManagerId> {
  const chosen = request.override ?? request.host;
  if (chosen !== undefined) {
    return chosen;
  }
  const detected = await detect({ cwd: request.cwd });
  if (detected !== null && isManager(detected.name)) {
    return detected.name;
  }
  const userAgent = getUserAgent();
  if (userAgent !== null && isManager(userAgent)) {
    return userAgent;
  }
  return "npm";
}

interface Spelling {
  readonly install: (
    packages: readonly string[],
    dev: boolean,
  ) => PackageManagerCommand;
  readonly run: (
    packageName: string,
    args: readonly string[],
  ) => PackageManagerCommand;
}

function spell(file: string, args: readonly string[]): PackageManagerCommand {
  return { file, args, line: [file, ...args].join(" ") };
}

function addSpelling(file: string): Spelling["install"] {
  return (packages, dev) =>
    spell(file, ["add", ...(dev ? ["-D"] : []), ...packages]);
}

/**
 * Every command line the engine will run, for every manager and both
 * forms. Nothing else in the engine spells a manager command.
 */
const SPELLINGS: Readonly<Record<PackageManagerId, Spelling>> = {
  npm: {
    install: addSpelling("npm"),
    run: (packageName, args) => spell("npx", [packageName, ...args]),
  },
  pnpm: {
    install: addSpelling("pnpm"),
    run: (packageName, args) => spell("pnpm", ["dlx", packageName, ...args]),
  },
  yarn: {
    install: addSpelling("yarn"),
    run: (packageName, args) => spell("yarn", ["dlx", packageName, ...args]),
  },
  bun: {
    install: addSpelling("bun"),
    run: (packageName, args) => spell("bunx", [packageName, ...args]),
  },
  deno: {
    install: (packages, dev) =>
      spell("deno", [
        "add",
        ...(dev ? ["--dev"] : []),
        ...packages.map((specifier) => `npm:${specifier}`),
      ]),
    run: (packageName, args) =>
      spell("deno", ["run", "-A", `npm:${packageName}`, ...args]),
  },
};

/** Adds dependencies to the project. */
export function installCommand(
  manager: PackageManagerId,
  request: {
    readonly packages: readonly string[];
    readonly dev?: boolean;
  },
): PackageManagerCommand {
  return SPELLINGS[manager].install(request.packages, request.dev ?? false);
}

/** Runs a package's bin once, without adding a dependency. */
export function runCommand(
  manager: PackageManagerId,
  request: {
    readonly package: string;
    readonly args?: readonly string[];
  },
): PackageManagerCommand {
  return SPELLINGS[manager].run(request.package, request.args ?? []);
}
