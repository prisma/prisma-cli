/**
 * Deciding whether a run is in CI is the engine's job, not a host's: a
 * host injects the environment and the engine reads ci-info's vendor
 * table against it. Pinned here: detection reads only the environment
 * it is handed, a host that answers nothing still gets CI whenever the
 * environment says so, the override wins in both directions, and the
 * matcher understands every shape the installed vendor table uses.
 */
import vendors from "ci-info/vendors.json" with { type: "json" };
import { afterEach, describe, expect, it } from "vitest";
import { detectCI, resolveIsCI } from "../src/ci";

type Env = Readonly<Record<string, string | undefined>>;

const DEVELOPER_SHELL: Env = {
  HOME: "/home/dev",
  TERM: "xterm-256color",
  EDITOR: "vim",
};

/** Real vendors, spelled as each one spells itself. TeamCity and Azure
 *  Pipelines set no CI variable at all, so only the vendor table finds
 *  them — they are why detection is a table lookup and not a check for
 *  one well-known variable. */
const GITHUB_ACTIONS: Env = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_RUN_ID: "1234567890",
};
const TEAMCITY: Env = { TEAMCITY_VERSION: "2024.03.1" };
const AZURE_PIPELINES: Env = { TF_BUILD: "True" };
const JENKINS: Env = {
  JENKINS_URL: "https://ci.example.invalid/",
  BUILD_ID: "42",
};

describe("detection reads the injected environment and nothing else", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("ignores a CI-looking process.env when the injected one is clean", () => {
    process.env.GITHUB_ACTIONS = "true";
    process.env.TEAMCITY_VERSION = "2024.03.1";

    expect(detectCI(DEVELOPER_SHELL)).toBe(false);
  });

  it("finds CI in the injected environment when process.env is clean", () => {
    process.env = { HOME: "/home/dev" };

    expect(detectCI(GITHUB_ACTIONS)).toBe(true);
  });
});

describe("detectCI", () => {
  it("says a developer's shell is not CI", () => {
    expect(detectCI(DEVELOPER_SHELL)).toBe(false);
  });

  it("says an empty environment is not CI", () => {
    expect(detectCI({})).toBe(false);
  });

  it.each([
    ["GitHub Actions", GITHUB_ACTIONS],
    ["TeamCity", TEAMCITY],
    ["Azure Pipelines", AZURE_PIPELINES],
    ["Jenkins", JENKINS],
    ["CircleCI", { CI: "true", CIRCLECI: "true" }],
  ])("says %s is CI", (_name, env) => {
    expect(detectCI(env)).toBe(true);
  });

  it("wants every variable a vendor names, not just one", () => {
    expect(detectCI({ JENKINS_URL: "https://ci.example.invalid/" })).toBe(
      false,
    );
    expect(detectCI(JENKINS)).toBe(true);
  });

  it("treats CI=false as a denial that outranks a vendor's own variables", () => {
    expect(detectCI({ ...GITHUB_ACTIONS, CI: "false" })).toBe(false);
  });

  it("treats an empty CI variable as unset", () => {
    expect(detectCI({ CI: "" })).toBe(false);
  });
});

describe("resolveIsCI", () => {
  it("detects when the host answers nothing", () => {
    expect(resolveIsCI({ env: TEAMCITY })).toBe(true);
    expect(resolveIsCI({ env: DEVELOPER_SHELL })).toBe(false);
  });

  it("lets the override win over detection in both directions", () => {
    expect(resolveIsCI({ env: TEAMCITY, isCIOverride: false })).toBe(false);
    expect(resolveIsCI({ env: DEVELOPER_SHELL, isCIOverride: true })).toBe(
      true,
    );
  });
});

/**
 * The vendor table is read from the installed ci-info rather than
 * copied into this repo, so an upgrade can introduce an entry shape the
 * matcher has never seen. Building each vendor's environment from its
 * own entry and asserting it is detected turns that into a failing
 * test: an unrecognised shape either throws here or produces an
 * environment detection misses.
 */
describe("every vendor in the installed table is detected", () => {
  type Check = string | Readonly<Record<string, unknown>>;

  function envTriggering(check: Check): Record<string, string> {
    if (typeof check === "string") {
      return { [check]: "1" };
    }
    const { env, includes, any } = check;
    if (typeof env === "string" && typeof includes === "string") {
      return { [env]: `/opt${includes}/bin` };
    }
    if (Array.isArray(any)) {
      return { [String(any[0])]: "1" };
    }
    if (Object.values(check).every((value) => typeof value === "string")) {
      return check as Record<string, string>;
    }
    throw new Error(
      `ci-info's vendor table gained an entry shape this test does not know: ${JSON.stringify(check)}`,
    );
  }

  const cases = (vendors as ReadonlyArray<{ name: string; env: unknown }>).map(
    (vendor) => {
      const checks = Array.isArray(vendor.env) ? vendor.env : [vendor.env];
      const env = Object.assign(
        {},
        ...checks.map((check: Check) => envTriggering(check)),
      ) as Env;
      return [vendor.name, env] as const;
    },
  );

  it("covers a table worth reading", () => {
    expect(cases.length).toBeGreaterThan(40);
  });

  it.each(cases)("detects %s", (_name, env) => {
    expect(detectCI(env)).toBe(true);
  });
});
