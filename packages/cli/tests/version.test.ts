import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

import { detectInvocation } from "../src/lib/version";
import { createTempCwd, executeCli } from "./helpers";

const requireFromHere = createRequire(import.meta.url);
const pkg = requireFromHere("../package.json") as { version: string };
const fixturePath = path.resolve("fixtures/mock-api.json");

describe("version", () => {
  it("prints the CLI version to stdout when --version is passed", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["--version"],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`prisma-cli ${pkg.version}\n`);
  });

  it("emits the stable success envelope when --version --json is passed", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["--version", "--json"],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "version",
      result: {
        version: pkg.version,
      },
      warnings: [],
      nextSteps: [],
      nextActions: [],
    });
  });

  it("renders the show pattern when the version subcommand runs", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["version"],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("version → Showing CLI build and environment.");
    expect(result.stderr).toContain(`prisma-cli:  ${pkg.version}`);
    expect(result.stderr).toContain(`node:        ${process.version}`);
    expect(result.stderr).toContain(`os:          ${process.platform} ${process.arch}`);
    expect(result.stderr).toContain("invocation:");
  });

  it("emits the full structured result when version --json is passed", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["version", "--json"],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      ok: true,
      command: "version",
      result: {
        cli: {
          name: "prisma-cli",
          version: pkg.version,
        },
        node: {
          version: process.version,
        },
        os: {
          platform: process.platform,
          arch: process.arch,
        },
      },
      warnings: [],
      nextSteps: [],
      nextActions: [],
    });
    expect(["bunx", "npx", "global", "dev", "unknown"]).toContain(payload.result.invocation);
  });

  it("requires no auth, no project context, and no network for the subcommand", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    // No fixturePath is provided — this exercises real mode without a mock API,
    // which would fail for any command that needs auth or platform calls.
    const result = await executeCli({
      argv: ["version", "--json"],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).ok).toBe(true);
  });

  it("requires no auth, no project context, and no network for the flag", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["--version", "--json"],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).ok).toBe(true);
  });

  it("includes version in the root --help output", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["--help"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/version\s+Show CLI build and environment/);
    expect(result.stderr).toContain("--version");
    expect(result.stderr).toContain("Print the CLI version and exit.");
  });

  it("--version overrides subcommand parsing when both are present", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    // --version is a top-level utility flag and takes precedence over any
    // subcommand path. Mirrors the same pattern as --help.
    const result = await executeCli({
      argv: ["auth", "login", "--version"],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`prisma-cli ${pkg.version}\n`);
    expect(result.stderr).toBe("");
  });

  it("does not classify normal npm script execution as npx", () => {
    expect(
      detectInvocation(
        {
          npm_config_user_agent: "npm/10.9.0 node/v24.14.1 darwin arm64 workspaces/false",
        },
        ["node", "/repo/node_modules/.bin/prisma-cli"],
      ),
    ).toBe("global");
  });

  it("detects Windows npx and global invocation paths", () => {
    expect(
      detectInvocation(
        {
          npm_execpath: "C:\\Users\\alice\\AppData\\Local\\npm-cache\\_npx\\1234\\node_modules\\npm\\bin\\npm-cli.js",
        },
        ["node", "C:\\Users\\alice\\AppData\\Local\\npm-cache\\_npx\\1234\\node_modules\\.bin\\prisma-cli.cmd"],
      ),
    ).toBe("npx");

    expect(detectInvocation({}, ["node", "C:\\Users\\alice\\AppData\\Roaming\\npm\\prisma-cli.cmd"])).toBe("global");
  });
});
