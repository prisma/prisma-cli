/**
 * Public typed config surface for `prisma.compute.ts`.
 *
 * This module is published as `@prisma/cli/config` and must stay free of
 * runtime dependencies so user config files can import it cheaply.
 */

export const COMPUTE_FRAMEWORKS = ["nextjs", "nuxt", "astro", "hono", "tanstack-start", "bun"] as const;

export type ComputeFramework = (typeof COMPUTE_FRAMEWORKS)[number];

export interface ComputeEnvConfig {
  /** Dotenv file path(s) resolved relative to the config file directory. */
  file?: string | string[];
  /**
   * Inline environment variable assignments. Values must be non-empty and
   * are deployed as-is. This file is committed — keep secrets in platform
   * branch config; consumers may ignore inline vars on git-push deploys.
   */
  vars?: Record<string, string>;
}

export interface ComputeBuildConfig {
  /** Build command run in the app root. `null` skips the build step. */
  command?: string | null;
  /** Framework output path relative to the app root, e.g. ".next/standalone". */
  outputDirectory?: string;
}


export interface ComputeAppConfig {
  /** Deployed app name. Defaults to the `apps` key, then package/directory inference. */
  name?: string;
  /** App directory relative to the config file. Defaults to the config file directory. */
  root?: string;
  /** Framework to deploy. Defaults to detection from the app directory. */
  framework?: ComputeFramework;
  /** Entrypoint path for Bun (and Hono) deploys, relative to the app root. */
  entry?: string;
  /** HTTP port the deployed app listens on. Defaults to the framework default. */
  httpPort?: number;
  /** Environment variables for the deploy. A string is shorthand for `{ file }`. */
  env?: string | ComputeEnvConfig;
  /** Build settings. When present, these own the app's build configuration. */
  build?: ComputeBuildConfig;
}

/**
 * `prisma.compute.ts` accepts exactly one of:
 *
 * - `app` — a repository that deploys a single app
 * - `apps` — a monorepo or multi-app repository, keyed by deploy target
 */
export type ComputeConfig =
  | { app: ComputeAppConfig; apps?: never }
  | { apps: Record<string, ComputeAppConfig>; app?: never };

/**
 * Identity helper that gives `prisma.compute.ts` full type checking:
 *
 * ```ts
 * import { defineComputeConfig } from "@prisma/cli/config";
 *
 * export default defineComputeConfig({
 *   app: { framework: "hono", httpPort: 8080 },
 * });
 * ```
 */
export function defineComputeConfig(config: ComputeConfig): ComputeConfig {
  return config;
}
