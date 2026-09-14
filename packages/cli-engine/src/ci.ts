import vendors from "ci-info/vendors.json" with { type: "json" };
import type { Runtime } from "./runtime";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * One way a vendor's entry says "this variable proves it is me". The
 * table uses four shapes: a variable name that must be set, `{ env,
 * includes }` for a variable that must contain a substring, `{ any }`
 * for a list where one must be set, and otherwise a set of variables
 * that must equal the given values.
 */
type VendorCheck = string | Readonly<Record<string, unknown>>;

interface Vendor {
  readonly name: string;
  readonly env: VendorCheck | readonly VendorCheck[];
}

/**
 * ci-info's provider table. Its `isCI` export is unusable — it reads
 * the real `process.env` at import; the engine reads only host-injected
 * env. The table is inlined into the build (tsdown `deps.alwaysBundle`): the
 * file is CJS-owned by ci-info, and loading it as ESM at runtime breaks
 * hosts that also require ci-info (Bun's dual registry; composer#234).
 * Pinned by tests/no-esm-json-import-in-dist.test.ts.
 */
const VENDORS: readonly Vendor[] = vendors;

/**
 * The variables ci-info checks outside the vendor table, catching CI
 * systems that set a conventional variable but have no table entry.
 * These are cross-vendor conventions rather than per-vendor facts,
 * which is why this list holds still while the table grows.
 */
const CONVENTIONAL_CI_VARS = [
  "BUILD_ID",
  "BUILD_NUMBER",
  "CI",
  "CI_APP_ID",
  "CI_BUILD_ID",
  "CI_BUILD_NUMBER",
  "CI_NAME",
  "CONTINUOUS_INTEGRATION",
  "RUN_ID",
] as const;

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

function checkMatches(check: VendorCheck, env: Env): boolean {
  if (typeof check === "string") {
    return isSet(env[check]);
  }
  const { env: variable, includes, any } = check;
  if (typeof variable === "string" && typeof includes === "string") {
    return env[variable]?.includes(includes) === true;
  }
  if (Array.isArray(any)) {
    return any.some((name: unknown) => isSet(env[String(name)]));
  }
  return Object.entries(check).every(([name, value]) => env[name] === value);
}

function vendorMatches(vendor: Vendor, env: Env): boolean {
  const checks = Array.isArray(vendor.env) ? vendor.env : [vendor.env];
  return checks.every((check: VendorCheck) => checkMatches(check, env));
}

/**
 * Whether this environment is a CI environment, by ci-info's rules
 * applied to the environment the host injected rather than to
 * `process.env`. `CI=false` is an explicit denial that stops every
 * other check, exactly as ci-info treats it.
 */
export function detectCI(env: Env): boolean {
  if (env.CI === "false") {
    return false;
  }
  if (CONVENTIONAL_CI_VARS.some((name) => isSet(env[name]))) {
    return true;
  }
  return VENDORS.some((vendor) => vendorMatches(vendor, env));
}

/**
 * The engine's one answer to "is this run in CI", read by telemetry
 * gating, `ctx.isCI` and the default interactivity decision. A host
 * that says nothing gets detection, so forgetting to answer cannot turn
 * a CI run into a reporting one.
 */
export function resolveIsCI(
  host: Pick<Runtime, "env" | "isCIOverride">,
): boolean {
  return host.isCIOverride ?? detectCI(host.env);
}
