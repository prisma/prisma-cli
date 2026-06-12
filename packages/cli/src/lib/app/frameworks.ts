import type { ComputeFramework } from "../../config";

/**
 * Framework capability registry — the single source of truth for what each
 * supported framework is and can do. Commands, config validation, detection,
 * and prompts all query this table; adding a framework means adding one
 * entry here plus its build/run strategy implementation.
 */

export type FrameworkBuildType = "nextjs" | "tanstack-start" | "bun";

export interface FrameworkDescriptor {
  readonly key: ComputeFramework;
  readonly displayName: string;
  /** Build/deploy strategy this framework uses. */
  readonly buildType: FrameworkBuildType;
  /** Accepted user-facing spellings, lowercased, including the key. */
  readonly aliases: readonly string[];
  /** Dependencies whose presence detects this framework. */
  readonly detectPackages: readonly string[];
  /** Config files whose presence detects this framework. */
  readonly detectConfigFiles: readonly string[];
  /** Consumes a user-provided source entrypoint instead of build output. */
  readonly usesEntrypoint: boolean;
  /** Entrypoint assumed when the package defines none. */
  readonly defaultEntrypoint: string | null;
  /** Has a local dev server (`app run`) in the current preview. */
  readonly hasLocalDevServer: boolean;
}

export const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.mts",
] as const;

// Detection checks frameworks in this order; keep more specific signals first.
export const FRAMEWORKS: readonly FrameworkDescriptor[] = [
  {
    key: "nextjs",
    displayName: "Next.js",
    buildType: "nextjs",
    aliases: ["nextjs", "next", "next.js"],
    detectPackages: ["next"],
    detectConfigFiles: NEXT_CONFIG_FILENAMES,
    usesEntrypoint: false,
    defaultEntrypoint: null,
    hasLocalDevServer: true,
  },
  {
    key: "hono",
    displayName: "Hono",
    buildType: "bun",
    aliases: ["hono"],
    detectPackages: ["hono"],
    detectConfigFiles: [],
    usesEntrypoint: true,
    defaultEntrypoint: "src/index.ts",
    hasLocalDevServer: true,
  },
  {
    key: "tanstack-start",
    displayName: "TanStack Start",
    buildType: "tanstack-start",
    aliases: ["tanstack-start", "tanstack", "@tanstack/react-start", "@tanstack/solid-start"],
    detectPackages: ["@tanstack/react-start", "@tanstack/solid-start"],
    detectConfigFiles: [],
    usesEntrypoint: false,
    defaultEntrypoint: null,
    hasLocalDevServer: false,
  },
  {
    key: "bun",
    displayName: "Bun",
    buildType: "bun",
    aliases: ["bun"],
    detectPackages: [],
    detectConfigFiles: [],
    usesEntrypoint: true,
    defaultEntrypoint: null,
    hasLocalDevServer: true,
  },
];

export const FRAMEWORK_KEYS = FRAMEWORKS.map((framework) => framework.key);

/** Build types whose build settings are backed by committed config. */
export const CONFIG_BACKED_BUILD_TYPES: readonly FrameworkBuildType[] = [
  ...new Set(FRAMEWORKS.map((framework) => framework.buildType)),
];

/** Build types that consume a user-provided source entrypoint. */
export const ENTRYPOINT_BUILD_TYPES: readonly FrameworkBuildType[] = [
  ...new Set(FRAMEWORKS.filter((framework) => framework.usesEntrypoint).map((framework) => framework.buildType)),
];

/** Build types `app run` can start a local dev server for. */
export const LOCAL_DEV_BUILD_TYPES: readonly FrameworkBuildType[] = [
  ...new Set(FRAMEWORKS.filter((framework) => framework.hasLocalDevServer).map((framework) => framework.buildType)),
];

export function frameworkByKey(key: ComputeFramework): FrameworkDescriptor {
  const framework = FRAMEWORKS.find((candidate) => candidate.key === key);
  if (!framework) {
    throw new Error(`Unknown framework key "${key}".`);
  }
  return framework;
}

export function frameworkFromAlias(value: string): FrameworkDescriptor | null {
  const normalized = value.trim().toLowerCase();
  return FRAMEWORKS.find((framework) => framework.aliases.includes(normalized)) ?? null;
}

export function isFrameworkBuildType(value: string): value is FrameworkBuildType {
  return (CONFIG_BACKED_BUILD_TYPES as readonly string[]).includes(value);
}
