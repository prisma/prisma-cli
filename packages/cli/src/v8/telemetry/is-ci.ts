import { isCI as ciInfoIsCI } from "ci-info";

/**
 * Returns true when the process is running in any CI environment
 * recognised by the `ci-info` package — the standard `CI=true` marker
 * plus dozens of provider-specific environment variables a raw
 * `process.env.CI` read misses. The single source of truth for CI
 * detection in the v8 shell so callers cannot drift from each other.
 */
export function isCI(): boolean {
  return ciInfoIsCI;
}
