import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  COMPUTE_CONFIG_FILENAME,
  ComputeConfigAmbiguousError,
  ComputeConfigInvalidError,
  ComputeConfigLoadError,
  ComputeConfigTargetRequiredError,
  ComputeConfigTargetUnknownError,
  defineComputeConfig,
  inferComputeTargetFromCwd,
  normalizeComputeConfig,
  selectComputeDeployTarget,
} from "@prisma/compute-sdk/config";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ComputeDeployTarget,
  computeConfigErrorToCliError,
  computeFrameworkToBuildType,
  type LoadedComputeConfig,
  loadComputeConfig,
  mergeComputeDeployInputs,
  mergeComputeLocalInputs,
} from "../src/lib/app/compute-config";
import { CliError } from "../src/shell/errors";

const CONFIG_PATH = "/repo/prisma.compute.ts";

function normalizeOrThrow(exported: unknown): LoadedComputeConfig {
  const result = normalizeComputeConfig(exported, CONFIG_PATH);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

function normalizeIssues(exported: unknown): string[] {
  const result = normalizeComputeConfig(exported, CONFIG_PATH);
  expect(result.isErr()).toBe(true);
  if (!result.isErr()) {
    throw new Error("expected invalid config");
  }
  expect(result.error).toBeInstanceOf(ComputeConfigInvalidError);
  return result.error.issues;
}

describe("normalizeComputeConfig", () => {
  it("normalizes a single-app config", () => {
    const config = normalizeOrThrow(
      defineComputeConfig({
        app: {
          name: "api",
          framework: "hono",
          httpPort: 8080,
          env: ".env",
        },
      }),
    );

    expect(config.kind).toBe("single");
    expect(config.relativeConfigPath).toBe(COMPUTE_CONFIG_FILENAME);
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0]).toMatchObject({
      key: null,
      name: "api",
      root: null,
      framework: "hono",
      entry: null,
      httpPort: 8080,
      envInputs: [".env"],
      build: null,
    });
  });

  it("normalizes a multi-app config with roots and env objects", () => {
    const config = normalizeOrThrow(
      defineComputeConfig({
        apps: {
          web: {
            root: "apps/web",
            framework: "nextjs",
            env: { file: "packages/db/.env" },
          },
          worker: {
            root: "./apps/worker/",
            framework: "bun",
            entry: "src/index.ts",
            env: {
              file: [".env", ".env.production"],
              vars: { LOG_LEVEL: "debug" },
            },
          },
        },
      }),
    );

    expect(config.kind).toBe("multi");
    expect(config.targets).toHaveLength(2);
    expect(config.targets[0]).toMatchObject({
      key: "web",
      root: "apps/web",
      framework: "nextjs",
      envInputs: ["packages/db/.env"],
    });
    expect(config.targets[1]).toMatchObject({
      key: "worker",
      root: "apps/worker",
      entry: "src/index.ts",
      envInputs: [".env", ".env.production", "LOG_LEVEL=debug"],
    });
  });

  it("rejects non-object default exports", () => {
    expect(normalizeIssues(undefined).join(" ")).toContain(
      "export default defineComputeConfig",
    );
    expect(normalizeIssues([1]).join(" ")).toContain(
      "export default defineComputeConfig",
    );
  });

  it("requires exactly one of app or apps", () => {
    expect(normalizeIssues({})).toEqual([
      "Define `app` for a single-app repository or `apps` for a multi-app repository.",
    ]);
    expect(normalizeIssues({ app: {}, apps: {} })).toEqual([
      "Use either `app` (single app) or `apps` (multi-app), not both.",
    ]);
    expect(normalizeIssues({ apps: {} })).toEqual([
      "`apps` must define at least one app.",
    ]);
  });

  it("rejects unknown keys to catch typos", () => {
    expect(normalizeIssues({ app: {}, framework: "hono" }).join(" ")).toContain(
      'Unknown top-level key "framework"',
    );
    expect(normalizeIssues({ app: { htpPort: 8080 } }).join(" ")).toContain(
      'Unknown key "htpPort"',
    );
    expect(
      normalizeIssues({ app: { env: { files: ".env" } } }).join(" "),
    ).toContain('Unknown key "files"');
  });

  it("validates field values", () => {
    const issues = normalizeIssues({
      apps: {
        web: {
          name: "",
          framework: "rails",
          httpPort: 0,
          root: "../outside",
          env: { vars: { EMPTY: "" } },
        },
      },
    });

    expect(issues.join(" ")).toContain(
      "`apps.web.name` must be a non-empty string.",
    );
    expect(issues.join(" ")).toContain(
      "`apps.web.framework` must be one of: nextjs, nuxt, astro, hono, nestjs, tanstack-start, custom, bun.",
    );
    expect(issues.join(" ")).toContain(
      "`apps.web.httpPort` must be an integer between 1 and 65535.",
    );
    expect(issues.join(" ")).toContain(
      "`apps.web.root` must be a relative path inside the repository.",
    );
    expect(issues.join(" ")).toContain(
      "`apps.web.env.vars.EMPTY` must be a non-empty string.",
    );
  });

  it("rejects roots that escape the config directory, including Windows drive-relative paths", () => {
    for (const root of ["C:apps", "C:/apps", "/apps", "..\\apps"]) {
      expect(normalizeIssues({ app: { root } }).join(" ")).toContain(
        "`app.root` must be a relative path inside the repository.",
      );
    }
  });

  it("normalizes build blocks", () => {
    const config = normalizeOrThrow(
      defineComputeConfig({
        apps: {
          web: {
            root: "apps/web",
            framework: "nextjs",
            build: {
              command: "pnpm --filter web build",
              outputDirectory: ".next/standalone/",
            },
          },
          api: {
            root: "apps/api",
            framework: "hono",
            build: { command: null },
          },
          docs: {
            root: "apps/docs",
            framework: "astro",
            build: {
              command: "npm run build",
              outputDirectory: "dist/server/",
            },
          },
          frontend: {
            root: "apps/frontend",
            framework: "custom",
            build: {
              command: "npm run build",
              outputDirectory: "build",
              entrypoint: "handler.js",
            },
          },
        },
      }),
    );

    expect(config.targets[0]).toMatchObject({
      build: {
        command: "pnpm --filter web build",
        outputDirectory: ".next/standalone",
      },
    });
    expect(config.targets[1]).toMatchObject({
      build: {
        command: null,
        outputDirectory: undefined,
        entrypoint: undefined,
      },
    });
    expect(config.targets[2]).toMatchObject({
      framework: "astro",
      build: {
        command: "npm run build",
        outputDirectory: "dist/server",
        entrypoint: undefined,
      },
    });
    expect(config.targets[3]).toMatchObject({
      framework: "custom",
      build: {
        command: "npm run build",
        outputDirectory: "build",
        entrypoint: "handler.js",
      },
    });
  });

  it("validates build blocks", () => {
    const issues = normalizeIssues({
      apps: {
        web: {
          build: { command: "", outputDir: ".next" },
          db: true,
        },
        api: {
          build: {},
        },
      },
    });

    expect(issues.join(" ")).toContain(
      "`apps.web.build.command` must be a non-empty string, or null to skip the build step.",
    );
    expect(issues.join(" ")).toContain(
      'Unknown key "outputDir" in `apps.web.build`.',
    );
    expect(issues.join(" ")).toContain('Unknown key "db" in `apps.web`.');
    expect(issues.join(" ")).toContain(
      "`apps.api.build` must set `command`, `outputDirectory`, and/or `entrypoint`.",
    );
  });

  it("rejects entry with frameworks that derive entrypoints from build output", () => {
    const issues = normalizeIssues({
      app: { framework: "nextjs", entry: "src/index.ts" },
    });
    expect(issues.join(" ")).toContain(
      "`app.entry` is not supported with the nextjs framework",
    );

    expect(
      normalizeOrThrow({ app: { framework: "hono", entry: "src/index.ts" } })
        .targets[0]?.entry,
    ).toBe("src/index.ts");
  });
});

describe("selectComputeDeployTarget", () => {
  const single = normalizeOrThrow({ app: { name: "api" } });
  const multi = normalizeOrThrow({
    apps: {
      web: { root: "apps/web" },
      worker: { root: "apps/worker" },
    },
  });

  it("returns the single app without a target argument", () => {
    expect(selectComputeDeployTarget(single, undefined).unwrap().name).toBe(
      "api",
    );
  });

  it("accepts a target argument matching the single app name", () => {
    expect(selectComputeDeployTarget(single, "api").unwrap().name).toBe("api");
  });

  it("rejects a target argument that does not match the single app", () => {
    const result = selectComputeDeployTarget(single, "web");
    expect(result.isErr() && result.error).toBeInstanceOf(
      ComputeConfigTargetUnknownError,
    );
  });

  it("requires a target when multiple apps are configured", () => {
    const result = selectComputeDeployTarget(multi, undefined);
    expect(result.isErr() && result.error).toBeInstanceOf(
      ComputeConfigTargetRequiredError,
    );
    if (
      result.isErr() &&
      result.error instanceof ComputeConfigTargetRequiredError
    ) {
      expect(result.error.availableTargets).toEqual(["web", "worker"]);
    }
  });

  it("selects a multi-app target by key", () => {
    expect(selectComputeDeployTarget(multi, "worker").unwrap().root).toBe(
      "apps/worker",
    );
  });

  it("defaults to the only app of a single-entry apps map", () => {
    const oneEntry = normalizeOrThrow({ apps: { web: { root: "apps/web" } } });
    expect(selectComputeDeployTarget(oneEntry, undefined).unwrap().key).toBe(
      "web",
    );
  });

  it("rejects unknown multi-app targets", () => {
    const result = selectComputeDeployTarget(multi, "docs");
    expect(result.isErr() && result.error).toBeInstanceOf(
      ComputeConfigTargetUnknownError,
    );
  });
});

describe("mergeComputeDeployInputs", () => {
  const target = {
    key: "web",
    name: null,
    region: "us-west-1",
    root: "apps/web",
    framework: "nextjs",
    entry: null,
    httpPort: 8080,
    envInputs: [".env", "LOG_LEVEL=debug"],
    build: null,
  } as ComputeDeployTarget;

  it("uses config values when flags are absent", () => {
    const merged = mergeComputeDeployInputs({
      cli: {},
      target,
      configFilename: COMPUTE_CONFIG_FILENAME,
    });

    expect(merged.framework).toEqual({
      value: "nextjs",
      annotation: "set by prisma.compute.ts",
    });
    expect(merged.httpPort).toEqual({
      value: "8080",
      annotation: "set by prisma.compute.ts",
    });
    expect(merged.region).toEqual({
      value: "us-west-1",
      annotation: "set by prisma.compute.ts",
    });
    expect(merged.envInputs).toEqual([".env", "LOG_LEVEL=debug"]);
    expect(merged.configAppName).toEqual({
      value: "web",
      annotation: "set by prisma.compute.ts",
    });
    expect(merged.appRoot).toBe("apps/web");
  });

  it("prefers explicit flags over config values", () => {
    const merged = mergeComputeDeployInputs({
      cli: {
        framework: "bun",
        entrypoint: "server.ts",
        httpPort: "3000",
        region: "eu-west-3",
        envInputs: ["DATABASE_URL=postgresql://example"],
      },
      target,
      configFilename: COMPUTE_CONFIG_FILENAME,
    });

    expect(merged.framework).toEqual({
      value: "bun",
      annotation: "set by --framework",
    });
    expect(merged.entrypoint).toEqual({
      value: "server.ts",
      annotation: "set by --entry",
    });
    expect(merged.httpPort).toEqual({
      value: "3000",
      annotation: "set by --http-port",
    });
    expect(merged.region).toEqual({
      value: "eu-west-3",
      annotation: "set by --region",
    });
    // --env replaces config env inputs entirely; they never merge.
    expect(merged.envInputs).toEqual(["DATABASE_URL=postgresql://example"]);
  });

  it("prefers the config name over the apps key", () => {
    const merged = mergeComputeDeployInputs({
      cli: {},
      target: { ...target, name: "storefront" },
      configFilename: COMPUTE_CONFIG_FILENAME,
    });

    expect(merged.configAppName?.value).toBe("storefront");
  });

  it("passes CLI values through without a config file", () => {
    const merged = mergeComputeDeployInputs({
      cli: { framework: "hono" },
      target: null,
      configFilename: COMPUTE_CONFIG_FILENAME,
    });

    expect(merged.framework).toEqual({
      value: "hono",
      annotation: "set by --framework",
    });
    expect(merged.entrypoint).toBeUndefined();
    expect(merged.region).toBeUndefined();
    expect(merged.envInputs).toBeUndefined();
    expect(merged.configAppName).toBeUndefined();
    expect(merged.appRoot).toBeUndefined();
  });
});

describe("mergeComputeLocalInputs", () => {
  const target = {
    key: "api",
    name: null,
    region: null,
    root: "apps/api",
    framework: "hono",
    entry: "src/index.ts",
    httpPort: 8080,
    envInputs: [],
    build: null,
  } as ComputeDeployTarget;

  it("maps the configured framework to a local build type", () => {
    expect(computeFrameworkToBuildType("nextjs")).toBe("nextjs");
    expect(computeFrameworkToBuildType("hono")).toBe("bun");
    expect(computeFrameworkToBuildType("bun")).toBe("bun");
    expect(computeFrameworkToBuildType("tanstack-start")).toBe(
      "tanstack-start",
    );
    expect(computeFrameworkToBuildType("custom")).toBe("custom");
  });

  it("uses config values when flags are absent or default", () => {
    const merged = mergeComputeLocalInputs({
      cli: { buildType: "auto" },
      target,
    });

    expect(merged).toEqual({
      entrypoint: "src/index.ts",
      buildType: "bun",
      buildTypeFromConfig: true,
      port: "8080",
      appRoot: "apps/api",
    });
  });

  it("prefers explicit flags over config values", () => {
    const merged = mergeComputeLocalInputs({
      cli: { entrypoint: "server.ts", buildType: "nextjs", port: "4000" },
      target,
    });

    expect(merged).toEqual({
      entrypoint: "server.ts",
      buildType: "nextjs",
      buildTypeFromConfig: false,
      port: "4000",
      appRoot: "apps/api",
    });
  });

  it("falls back to auto detection without a config target", () => {
    const merged = mergeComputeLocalInputs({
      cli: { buildType: "auto" },
      target: null,
    });

    expect(merged).toEqual({
      entrypoint: undefined,
      buildType: undefined,
      buildTypeFromConfig: false,
      port: undefined,
      appRoot: undefined,
    });
  });
});

describe("loadComputeConfig", () => {
  const tempDirs: string[] = [];

  async function createTempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "prisma-compute-config-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("returns null when no config file exists", async () => {
    const dir = await createTempDir();
    expect((await loadComputeConfig(dir)).unwrap()).toBeNull();
  });

  it("loads a TypeScript config that imports @prisma/compute-sdk/config", async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, "prisma.compute.ts"),
      [
        'import { defineComputeConfig } from "@prisma/compute-sdk/config";',
        "",
        "export default defineComputeConfig({",
        '  app: { name: "api", framework: "hono", httpPort: 8080 satisfies number },',
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = (await loadComputeConfig(dir)).unwrap();
    expect(config?.kind).toBe("single");
    expect(config?.targets[0]).toMatchObject({
      name: "api",
      framework: "hono",
      httpPort: 8080,
    });
  });

  it("loads a plain JavaScript config", async () => {
    const dir = await createTempDir();
    await mkdir(path.join(dir, "apps/web"), { recursive: true });
    await writeFile(
      path.join(dir, "prisma.compute.mjs"),
      [
        "export default {",
        '  apps: { web: { root: "apps/web", framework: "nextjs" } },',
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = (await loadComputeConfig(dir)).unwrap();
    expect(config?.kind).toBe("multi");
    expect(config?.targets[0]).toMatchObject({
      key: "web",
      root: "apps/web",
      framework: "nextjs",
    });
  });

  it("returns a load error for configs that fail to evaluate", async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, "prisma.compute.ts"),
      "export default {",
      "utf8",
    );

    const result = await loadComputeConfig(dir);
    expect(result.isErr() && result.error).toBeInstanceOf(
      ComputeConfigLoadError,
    );
  });

  it("returns an invalid error for configs without a default export", async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, "prisma.compute.ts"),
      'export const app = { name: "api" };\n',
      "utf8",
    );

    const result = await loadComputeConfig(dir);
    expect(result.isErr() && result.error).toBeInstanceOf(
      ComputeConfigInvalidError,
    );
  });

  it("rejects multiple coexisting config files", async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, "prisma.compute.ts"),
      "export default { app: {} };\n",
      "utf8",
    );
    await writeFile(
      path.join(dir, "prisma.compute.js"),
      "export default { app: {} };\n",
      "utf8",
    );

    const result = await loadComputeConfig(dir);
    expect(result.isErr() && result.error).toBeInstanceOf(
      ComputeConfigAmbiguousError,
    );
  });

  it("discovers the config upward from a nested directory inside a repository", async () => {
    const dir = await createTempDir();
    await mkdir(path.join(dir, ".git"), { recursive: true });
    await mkdir(path.join(dir, "apps", "api", "src"), { recursive: true });
    await writeFile(
      path.join(dir, "prisma.compute.ts"),
      'export default { apps: { api: { root: "apps/api" } } };\n',
      "utf8",
    );

    const config = (
      await loadComputeConfig(path.join(dir, "apps", "api", "src"))
    ).unwrap();
    expect(config?.configDir).toBe(dir);
    expect(config?.targets[0]?.key).toBe("api");
  });

  it("prefers the nearest config over an ancestor config", async () => {
    const dir = await createTempDir();
    await mkdir(path.join(dir, ".git"), { recursive: true });
    await mkdir(path.join(dir, "apps", "api"), { recursive: true });
    await writeFile(
      path.join(dir, "prisma.compute.ts"),
      'export default { app: { name: "root" } };\n',
      "utf8",
    );
    await writeFile(
      path.join(dir, "apps", "api", "prisma.compute.ts"),
      'export default { app: { name: "nested" } };\n',
      "utf8",
    );

    const config = (
      await loadComputeConfig(path.join(dir, "apps", "api"))
    ).unwrap();
    expect(config?.targets[0]?.name).toBe("nested");
    expect(config?.configDir).toBe(path.join(dir, "apps", "api"));
  });

  it("does not search above the repository root", async () => {
    const dir = await createTempDir();
    const repo = path.join(dir, "repo");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(path.join(repo, "app"), { recursive: true });
    // A config above the repository boundary must never be picked up.
    await writeFile(
      path.join(dir, "prisma.compute.ts"),
      'export default { app: { name: "outside" } };\n',
      "utf8",
    );

    expect(
      (await loadComputeConfig(path.join(repo, "app"))).unwrap(),
    ).toBeNull();
  });

  it("does not walk upward without a repository boundary", async () => {
    const dir = await createTempDir();
    await mkdir(path.join(dir, "nested"), { recursive: true });
    await writeFile(
      path.join(dir, "prisma.compute.ts"),
      'export default { app: { name: "parent" } };\n',
      "utf8",
    );

    // No .git or workspace marker anywhere: only the invocation directory is checked.
    expect(
      (await loadComputeConfig(path.join(dir, "nested"))).unwrap(),
    ).toBeNull();
  });

  it("observes config file edits across repeated loads", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "prisma.compute.ts");
    await writeFile(
      configPath,
      'export default { app: { name: "one" } };\n',
      "utf8",
    );
    expect((await loadComputeConfig(dir)).unwrap()?.targets[0]?.name).toBe(
      "one",
    );

    await writeFile(
      configPath,
      'export default { app: { name: "two" } };\n',
      "utf8",
    );
    expect((await loadComputeConfig(dir)).unwrap()?.targets[0]?.name).toBe(
      "two",
    );
  });
});

describe("compute config discovery and state location", () => {
  const tempDirs: string[] = [];

  async function createTempDir(): Promise<string> {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "prisma-compute-discovery-"),
    );
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("locates the nearest config directory without loading the config", async () => {
    const { findComputeConfigDir } = await import("@prisma/compute-sdk/config");
    const dir = await createTempDir();
    await mkdir(path.join(dir, ".git"), { recursive: true });
    await mkdir(path.join(dir, "apps", "api"), { recursive: true });
    // Deliberately broken config: location discovery must not evaluate it.
    await writeFile(
      path.join(dir, "prisma.compute.ts"),
      "export default {",
      "utf8",
    );

    expect(await findComputeConfigDir(path.join(dir, "apps", "api"))).toBe(dir);
    expect(await findComputeConfigDir(dir)).toBe(dir);
  });

  it("returns null without a config or outside the repository boundary", async () => {
    const { findComputeConfigDir } = await import("@prisma/compute-sdk/config");
    const dir = await createTempDir();
    const repo = path.join(dir, "repo");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(path.join(repo, "app"), { recursive: true });
    await writeFile(
      path.join(dir, "prisma.compute.ts"),
      "export default { app: {} };\n",
      "utf8",
    );

    expect(await findComputeConfigDir(path.join(repo, "app"))).toBeNull();
  });

  it("anchors the default state directory at the config directory", async () => {
    const { resolveStateDir } = await import("../src/shell/runtime");
    const dir = await createTempDir();
    const appCwd = path.join(dir, "apps", "api");
    await mkdir(path.join(dir, ".git"), { recursive: true });
    await mkdir(appCwd, { recursive: true });
    await writeFile(
      path.join(dir, "prisma.compute.ts"),
      "export default { app: {} };\n",
      "utf8",
    );

    const runtime = { cwd: appCwd, env: {} } as Parameters<
      typeof resolveStateDir
    >[0];
    expect(await resolveStateDir(runtime)).toBe(
      path.join(dir, ".prisma", "cli"),
    );

    const standaloneRuntime = {
      cwd: dir,
      env: {},
      stateDir: "/explicit/state",
    } as Parameters<typeof resolveStateDir>[0];
    expect(await resolveStateDir(standaloneRuntime)).toBe("/explicit/state");
  });

  it("keeps the default state directory at the invocation directory without a config", async () => {
    const { resolveStateDir } = await import("../src/shell/runtime");
    const dir = await createTempDir();
    const appCwd = path.join(dir, "apps", "api");
    await mkdir(path.join(dir, ".git"), { recursive: true });
    await mkdir(appCwd, { recursive: true });

    const runtime = { cwd: appCwd, env: {} } as Parameters<
      typeof resolveStateDir
    >[0];
    expect(await resolveStateDir(runtime)).toBe(
      path.join(appCwd, ".prisma", "cli"),
    );
  });
});

describe("inferComputeTargetFromCwd", () => {
  function multiConfig(
    configDir: string,
    apps: Record<string, { root?: string }>,
  ): LoadedComputeConfig {
    const result = normalizeComputeConfig(
      { apps },
      path.join(configDir, COMPUTE_CONFIG_FILENAME),
    );
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  }

  const config = multiConfig("/repo", {
    api: { root: "apps/api" },
    web: { root: "apps/web" },
  });

  it("infers the target whose root contains the invocation directory", () => {
    expect(inferComputeTargetFromCwd(config, "/repo/apps/api")).toBe("api");
    expect(inferComputeTargetFromCwd(config, "/repo/apps/api/src/routes")).toBe(
      "api",
    );
    expect(inferComputeTargetFromCwd(config, "/repo/apps/web")).toBe("web");
  });

  it("infers nothing from the config directory or outside any root", () => {
    expect(inferComputeTargetFromCwd(config, "/repo")).toBeUndefined();
    expect(
      inferComputeTargetFromCwd(config, "/repo/packages/db"),
    ).toBeUndefined();
  });

  it("picks the deepest root when targets nest", () => {
    const nested = multiConfig("/repo", {
      all: { root: "apps" },
      api: { root: "apps/api" },
    });

    expect(inferComputeTargetFromCwd(nested, "/repo/apps/api")).toBe("api");
    expect(inferComputeTargetFromCwd(nested, "/repo/apps/web")).toBe("all");
  });

  it("infers nothing on an ambiguous tie", () => {
    const tied = multiConfig("/repo", {
      one: { root: "apps/shared" },
      two: { root: "apps/shared" },
    });

    expect(
      inferComputeTargetFromCwd(tied, "/repo/apps/shared"),
    ).toBeUndefined();
  });

  it("never infers for single-app configs", () => {
    const single = normalizeComputeConfig(
      { app: { name: "api" } },
      "/repo/prisma.compute.ts",
    );
    expect(
      inferComputeTargetFromCwd(single.unwrap(), "/repo/anywhere"),
    ).toBeUndefined();
  });
});

describe("computeConfigErrorToCliError", () => {
  it("maps config errors to structured CliErrors", () => {
    const invalid = computeConfigErrorToCliError(
      new ComputeConfigInvalidError(CONFIG_PATH, ["bad"]),
    );
    expect(invalid).toBeInstanceOf(CliError);
    expect(invalid.code).toBe("COMPUTE_CONFIG_INVALID");
    expect(invalid.exitCode).toBe(2);

    const required = computeConfigErrorToCliError(
      new ComputeConfigTargetRequiredError(CONFIG_PATH, ["web", "worker"]),
    );
    expect(required.code).toBe("COMPUTE_CONFIG_TARGET_REQUIRED");
    expect(required.nextSteps).toEqual([
      "prisma-cli app deploy web",
      "prisma-cli app deploy worker",
    ]);

    const unknown = computeConfigErrorToCliError(
      new ComputeConfigTargetUnknownError(CONFIG_PATH, "docs", ["web"]),
    );
    expect(unknown.code).toBe("COMPUTE_CONFIG_TARGET_UNKNOWN");
    expect(unknown.summary).toContain('"docs"');
  });
});
