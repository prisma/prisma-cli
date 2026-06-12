import type { ComputeFramework } from "../../config";

/**
 * Framework capability registry — the single source of truth for what each
 * supported framework is and can do. Commands, config validation, detection,
 * and prompts all query this table; adding a framework means adding one
 * entry here plus its build/run strategy implementation.
 */

export type FrameworkBuildType = "nextjs" | "nuxt" | "astro" | "tanstack-start" | "bun";

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

export const NUXT_CONFIG_FILENAMES = [
  "nuxt.config.js",
  "nuxt.config.mjs",
  "nuxt.config.cjs",
  "nuxt.config.ts",
  "nuxt.config.mts",
] as const;

export const ASTRO_CONFIG_FILENAMES = [
  "astro.config.js",
  "astro.config.mjs",
  "astro.config.cjs",
  "astro.config.ts",
  "astro.config.mts",
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
    key: "nuxt",
    displayName: "Nuxt",
    buildType: "nuxt",
    aliases: ["nuxt", "nuxtjs", "nuxt.js"],
    detectPackages: ["nuxt"],
    detectConfigFiles: NUXT_CONFIG_FILENAMES,
    usesEntrypoint: false,
    defaultEntrypoint: null,
    hasLocalDevServer: false,
  },
  {
    key: "astro",
    displayName: "Astro",
    buildType: "astro",
    aliases: ["astro"],
    detectPackages: ["astro"],
    detectConfigFiles: ASTRO_CONFIG_FILENAMES,
    usesEntrypoint: false,
    defaultEntrypoint: null,
    hasLocalDevServer: false,
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

/**
 * Build types whose preview build consumes committed build settings. The
 * others (nuxt, astro) run their framework CLI and stage fixed output, so a
 * config `build` block has nothing to apply to.
 */
export const CONFIG_BACKED_BUILD_TYPES = ["nextjs", "tanstack-start", "bun"] as const satisfies readonly FrameworkBuildType[];

export type ConfigBackedBuildType = (typeof CONFIG_BACKED_BUILD_TYPES)[number];

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

export function isConfigBackedBuildType(value: string): value is ConfigBackedBuildType {
  return (CONFIG_BACKED_BUILD_TYPES as readonly string[]).includes(value);
}
