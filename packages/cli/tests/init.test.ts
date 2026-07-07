import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  COMPUTE_CONFIG_JSON_SCHEMA_URL,
  loadComputeConfig,
} from "@prisma/compute-sdk/config";
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";

import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

async function login(cwd: string, stateDir: string) {
  await executeCli({
    argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
    cwd,
    stateDir,
    fixturePath,
  });
}

async function writePackageJson(
  cwd: string,
  contents: Record<string, unknown>,
) {
  await writeFile(
    path.join(cwd, "package.json"),
    `${JSON.stringify(contents, null, 2)}\n`,
    "utf8",
  );
}

async function readConfig(cwd: string): Promise<string> {
  return readFile(path.join(cwd, "prisma.compute.ts"), "utf8");
}

async function readJsonConfig(cwd: string): Promise<string> {
  return readFile(path.join(cwd, "prisma.compute.json"), "utf8");
}

describe("init", () => {
  it("writes a config for an explicit framework without auth or prompts", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "billing-api" });

    const result = await executeCli({
      argv: [
        "init",
        "--framework",
        "hono",
        "--entry",
        "src/index.ts",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      ok: true,
      command: "init",
      result: {
        configPath: "prisma.compute.ts",
        app: {
          name: "billing-api",
          framework: "hono",
          entry: "src/index.ts",
        },
        types: {
          status: "skipped",
          package: "@prisma/compute-sdk",
          installCommand: "npm install -D @prisma/compute-sdk",
        },
        link: { status: "skipped", project: null },
      },
      nextSteps: [
        "npm install -D @prisma/compute-sdk",
        "npx -y @prisma/cli@latest app deploy",
        "npx -y @prisma/cli@latest project link",
      ],
    });

    const config = await readConfig(cwd);
    expect(config).toContain('framework: "hono"');
    expect(config).toContain('name: "billing-api"');
    expect(config).toContain('entry: "src/index.ts"');
    expect(config).toContain("defineComputeConfig");
  });

  it("detects Next.js from the config file and uses the framework default port", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "web" });
    await writeFile(path.join(cwd, "next.config.ts"), "export default {};\n");

    const result = await executeCli({
      argv: ["init", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.app).toMatchObject({
      name: "web",
      framework: "nextjs",
      httpPort: 3000,
    });
    expect(payload.result.settings).toContainEqual(
      expect.objectContaining({
        key: "framework",
        source: expect.stringContaining("next.config.ts"),
      }),
    );
  });

  it("fails with INIT_DETECTION_FAILED when nothing is detectable non-interactively", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["init", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload).toMatchObject({
      ok: false,
      command: "init",
      error: { code: "INIT_DETECTION_FAILED" },
    });
    expect(payload.error.meta.frameworks).toContain("hono");
  });

  it("fails with INIT_CONFIG_EXISTS when a config exists here or in an ancestor", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      'export default { app: { framework: "hono" } };\n',
    );

    const direct = await executeCli({
      argv: ["init", "--framework", "hono", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const directPayload = JSON.parse(direct.stdout);

    expect(direct.exitCode).toBe(1);
    expect(directPayload.error.code).toBe("INIT_CONFIG_EXISTS");
    expect(directPayload.error.meta.existingConfigPath).toContain(
      "prisma.compute.ts",
    );

    // Ancestor config: init from a nested app dir must refuse a nested config.
    await mkdir(path.join(cwd, ".git"), { recursive: true });
    const nested = path.join(cwd, "apps", "api");
    await mkdir(nested, { recursive: true });
    const fromNested = await executeCli({
      argv: ["init", "--framework", "hono", "--json"],
      cwd: nested,
      stateDir,
      fixturePath,
    });
    const nestedPayload = JSON.parse(fromNested.stdout);

    expect(fromNested.exitCode).toBe(1);
    expect(nestedPayload.error.code).toBe("INIT_CONFIG_EXISTS");
  });

  it("rejects invalid ports, regions, and frameworks before writing", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    for (const argv of [
      ["init", "--framework", "hono", "--http-port", "70000", "--json"],
      ["init", "--framework", "hono", "--region", "mars-1", "--json"],
      ["init", "--framework", "rails", "--json"],
    ]) {
      const result = await executeCli({ argv, cwd, stateDir, fixturePath });
      const payload = JSON.parse(result.stdout);
      expect(result.exitCode).toBe(2);
      expect(payload.error.code).toBe("USAGE_ERROR");
    }

    await expect(readConfig(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("links to an explicit --project and reports it", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "api" });
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["init", "--framework", "hono", "--project", "proj_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.link).toMatchObject({
      status: "linked",
      project: { id: "proj_123", name: "Acme Dashboard" },
    });
    expect(payload.nextSteps).toEqual([
      "npm install -D @prisma/compute-sdk",
      "npx -y @prisma/cli@latest app deploy",
    ]);
    await expect(
      readFile(path.join(cwd, ".prisma/local.json"), "utf8"),
    ).resolves.toContain("proj_123");
  });

  it("downgrades a failed link to a warning and keeps the config", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "api" });
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["init", "--framework", "hono", "--project", "nope", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.link.status).toBe("failed");
    expect(payload.warnings[0]).toContain("Project link failed");
    expect(payload.nextSteps).toContain(
      "npx -y @prisma/cli@latest project link",
    );
    await expect(readConfig(cwd)).resolves.toContain('framework: "hono"');
  });

  it("reports already-linked directories without prompting", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "api" });
    await mkdir(path.join(cwd, ".prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, ".prisma/local.json"),
      `${JSON.stringify({ workspaceId: "ws_123", projectId: "proj_123" })}\n`,
    );

    const result = await executeCli({
      argv: ["init", "--framework", "hono", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.link.status).toBe("already-linked");
    expect(payload.nextSteps).toEqual([
      "npm install -D @prisma/compute-sdk",
      "npx -y @prisma/cli@latest app deploy",
    ]);
  });

  it("prints the human summary with the wrote line", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "api" });

    const result = await executeCli({
      argv: ["init", "--framework", "hono", "--no-link"],
      cwd,
      stateDir,
      fixturePath,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("framework");
    expect(stderr).toContain("Hono");
    expect(stderr).toContain("✔ Wrote prisma.compute.ts");
    expect(stderr).toContain("Not linked to a Project yet");
    expect(stderr).toContain("Next steps");
  });

  it("appends the build stub for custom framework configs", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["init", "--framework", "custom", "--no-link", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    const config = await readConfig(cwd);
    expect(config).toContain('framework: "custom"');
    expect(config).toContain("// build: {");
  });
});

describe("init types install", () => {
  it("reports already-installed when the sdk is a devDependency", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, {
      name: "api",
      devDependencies: { "@prisma/compute-sdk": "^0.1.0" },
    });

    const result = await executeCli({
      argv: ["init", "--framework", "hono", "--no-link", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.types).toEqual({
      status: "already-installed",
      package: "@prisma/compute-sdk",
      installCommand: null,
    });
    expect(payload.nextSteps).not.toContain(
      "npm install -D @prisma/compute-sdk",
    );
  });

  it("skips with --no-install and keeps the hint in nextSteps", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "api" });

    const result = await executeCli({
      argv: [
        "init",
        "--framework",
        "hono",
        "--no-install",
        "--no-link",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.types.status).toBe("skipped");
    expect(payload.nextSteps).toContain("npm install -D @prisma/compute-sdk");
  });

  it("installs with --install and reports success", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "api" });

    const result = await executeCli({
      argv: ["init", "--framework", "hono", "--install", "--no-link", "--json"],
      cwd,
      stateDir,
      fixturePath,
      env: {
        PRISMA_CLI_INIT_INSTALL_COMMAND: JSON.stringify([
          "node",
          "-e",
          "process.exit(0)",
        ]),
      },
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.types.status).toBe("installed");
    expect(payload.warnings).toEqual([]);
  });

  it("downgrades a failed install to a warning", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "api" });

    const result = await executeCli({
      argv: ["init", "--framework", "hono", "--install", "--no-link", "--json"],
      cwd,
      stateDir,
      fixturePath,
      env: {
        PRISMA_CLI_INIT_INSTALL_COMMAND: JSON.stringify([
          "node",
          "-e",
          "process.exit(1)",
        ]),
      },
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.types.status).toBe("failed");
    expect(payload.warnings[0]).toContain(
      "Installing @prisma/compute-sdk failed",
    );
    expect(payload.warnings[0]).toContain("npm install -D @prisma/compute-sdk");
  });
});

describe("init config format", () => {
  it("writes a $schema-first prisma.compute.json with --format json that round-trips through the loader", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "billing-api" });

    const result = await executeCli({
      argv: [
        "init",
        "--framework",
        "hono",
        "--entry",
        "src/index.ts",
        "--no-link",
        "--format",
        "json",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      ok: true,
      command: "init",
      result: {
        configPath: "prisma.compute.json",
        format: "json",
        converted: false,
        app: {
          name: "billing-api",
          framework: "hono",
          entry: "src/index.ts",
        },
        // The JSON format is dependency-free by design, so the types install
        // step never runs and no install hint is emitted.
        types: {
          status: "skipped",
          package: "@prisma/compute-sdk",
          installCommand: null,
        },
      },
    });
    expect(payload.nextSteps).toEqual([
      "npx -y @prisma/cli@latest app deploy",
      "npx -y @prisma/cli@latest project link",
    ]);

    const written = JSON.parse(await readJsonConfig(cwd));
    expect(Object.keys(written)[0]).toBe("$schema");
    expect(written.$schema).toBe(COMPUTE_CONFIG_JSON_SCHEMA_URL);
    expect(written.app).toMatchObject({
      name: "billing-api",
      framework: "hono",
      entry: "src/index.ts",
    });

    const loaded = await loadComputeConfig(cwd);
    expect(loaded.isOk()).toBe(true);
    expect(loaded.isOk() && loaded.value?.targets[0]).toMatchObject({
      name: "billing-api",
      framework: "hono",
      entry: "src/index.ts",
      httpPort: payload.result.app.httpPort,
    });
    await expect(readConfig(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes prisma.compute.ts with an explicit --format ts", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "api" });

    const result = await executeCli({
      argv: [
        "init",
        "--framework",
        "hono",
        "--no-link",
        "--format",
        "ts",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result).toMatchObject({
      configPath: "prisma.compute.ts",
      format: "typescript",
      converted: false,
    });
    await expect(readConfig(cwd)).resolves.toContain("defineComputeConfig");
  });

  it("rejects --install with --format json as a usage error", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "api" });

    const result = await executeCli({
      argv: [
        "init",
        "--framework",
        "hono",
        "--install",
        "--format",
        "json",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload.error.code).toBe("USAGE_ERROR");
    await expect(readJsonConfig(cwd)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects unknown --format values as a usage error", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["init", "--framework", "hono", "--format", "yaml", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload.error.code).toBe("USAGE_ERROR");
  });

  it("rejects --format json for the custom framework and writes nothing", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: [
        "init",
        "--framework",
        "custom",
        "--no-link",
        "--format",
        "json",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload.error.code).toBe("USAGE_ERROR");
    expect(payload.error.summary).toContain("TypeScript config format");
    await expect(readJsonConfig(cwd)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails with INIT_CONVERT_UNSUPPORTED when a TypeScript config exists and --format json is passed", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      'export default { app: { framework: "hono" } };\n',
    );

    const result = await executeCli({
      argv: ["init", "--framework", "hono", "--format", "json", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload.error.code).toBe("INIT_CONVERT_UNSUPPORTED");
    expect(payload.error.fix).toContain("rewrite it by hand");
    expect(payload.error.meta.existingConfigPath).toContain(
      "prisma.compute.ts",
    );
    await expect(readJsonConfig(cwd)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses plain init when prisma.compute.json exists", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(
      path.join(cwd, "prisma.compute.json"),
      `${JSON.stringify({ app: { framework: "hono" } })}\n`,
    );

    // Conversion must be explicit via --format ts; plain init and a repeated
    // --format json both refuse.
    for (const argv of [
      ["init", "--framework", "hono", "--json"],
      ["init", "--framework", "hono", "--format", "json", "--json"],
    ]) {
      const result = await executeCli({ argv, cwd, stateDir, fixturePath });
      const payload = JSON.parse(result.stdout);
      expect(result.exitCode).toBe(1);
      expect(payload.error.code).toBe("INIT_CONFIG_EXISTS");
      expect(payload.error.meta.existingConfigPath).toContain(
        "prisma.compute.json",
      );
    }
  });

  it("converts prisma.compute.json to prisma.compute.ts with --format ts", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(
      path.join(cwd, "prisma.compute.json"),
      `${JSON.stringify(
        {
          $schema: COMPUTE_CONFIG_JSON_SCHEMA_URL,
          app: {
            name: "billing-api",
            framework: "hono",
            entry: "src/index.ts",
            httpPort: 8080,
            region: "us-east-1",
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = await executeCli({
      argv: ["init", "--format", "ts", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result).toMatchObject({
      configPath: "prisma.compute.ts",
      format: "typescript",
      converted: true,
      app: {
        name: "billing-api",
        framework: "hono",
        entry: "src/index.ts",
        httpPort: 8080,
        region: "us-east-1",
      },
    });
    expect(payload.result.settings).toContainEqual({
      key: "framework",
      value: "Hono",
      source: "prisma.compute.json",
    });

    const config = await readConfig(cwd);
    expect(config).toContain("defineComputeConfig");
    expect(config).toContain('name: "billing-api"');
    expect(config).toContain('framework: "hono"');
    expect(config).toContain('entry: "src/index.ts"');
    expect(config).toContain("httpPort: 8080");
    expect(config).toContain('region: "us-east-1"');
    expect(config).not.toContain("$schema");
    await expect(readJsonConfig(cwd)).rejects.toMatchObject({
      code: "ENOENT",
    });

    const loaded = await loadComputeConfig(cwd);
    expect(loaded.isOk()).toBe(true);
    expect(loaded.isOk() && loaded.value?.targets[0]).toMatchObject({
      name: "billing-api",
      framework: "hono",
      entry: "src/index.ts",
      httpPort: 8080,
      region: "us-east-1",
    });
  });

  it("runs the types install step when converting with --install", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "api" });
    await writeFile(
      path.join(cwd, "prisma.compute.json"),
      `${JSON.stringify({ app: { framework: "hono", httpPort: 8080 } })}\n`,
    );

    const result = await executeCli({
      argv: ["init", "--format", "ts", "--install", "--json"],
      cwd,
      stateDir,
      fixturePath,
      env: {
        PRISMA_CLI_INIT_INSTALL_COMMAND: JSON.stringify([
          "node",
          "-e",
          "process.exit(0)",
        ]),
      },
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.converted).toBe(true);
    // A hand-written config without a pinned name reports no app identity.
    expect(payload.result.app).toBeNull();
    expect(payload.result.types.status).toBe("installed");
  });

  it("prints the human conversion summary", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(
      path.join(cwd, "prisma.compute.json"),
      `${JSON.stringify({ app: { framework: "hono", httpPort: 8080 } })}\n`,
    );

    const result = await executeCli({
      argv: ["init", "--format", "ts", "--no-install"],
      cwd,
      stateDir,
      fixturePath,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(stderr).toContain(
      "✔ Converted prisma.compute.json to prisma.compute.ts",
    );
  });
});

describe("init edge cases", () => {
  it("rejects --entry for frameworks that derive their entrypoint", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, { name: "web" });

    const result = await executeCli({
      argv: [
        "init",
        "--framework",
        "nextjs",
        "--entry",
        "src/index.ts",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload).toMatchObject({
      ok: false,
      command: "init",
      error: { code: "USAGE_ERROR" },
    });
    await expect(readConfig(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the written config when package.json is unreadable in the types step", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(path.join(cwd, "package.json"), "{ not json", "utf8");

    const result = await executeCli({
      argv: [
        "init",
        "--framework",
        "hono",
        "--entry",
        "src/index.ts",
        "--name",
        "api",
        "--no-link",
        "--install",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.result.types.status).toBe("skipped");
    expect(payload.warnings[0]).toContain("package.json could not be read");
    await expect(readConfig(cwd)).resolves.toContain('framework: "hono"');
  });
});
