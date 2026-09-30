// biome-ignore-all lint/performance/noAwaitInLoops: each assertion checks an installed client directory.
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import { CLI_BINARY } from "./harness";

const run = promisify(execFile);
const roots: string[] = [];
async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), "prisma-agent-install-"));
  roots.push(root);
  return root;
}
async function install(cwd: string, args: string[] = []) {
  return run(
    process.execPath,
    [CLI_BINARY, "agent", "install", "--json", ...args],
    {
      cwd,
      env: {
        ...process.env,
        HOME: cwd,
        PRISMA_DISABLE_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
      },
    },
  );
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("agent install through the built binary", () => {
  it("installs all clients without a Prisma package or credential and is idempotent", async () => {
    const cwd = await project();
    await install(cwd);
    const codex = parseToml(
      await readFile(path.join(cwd, ".codex/config.toml"), "utf8"),
    );
    expect(codex).toEqual({
      mcp_servers: { prisma: { url: "https://mcp.prisma.io/mcp" } },
    });
    expect(
      JSON.parse(await readFile(path.join(cwd, ".mcp.json"), "utf8")),
    ).toEqual({
      mcpServers: {
        prisma: { type: "http", url: "https://mcp.prisma.io/mcp" },
      },
    });
    for (const dir of [".agents", ".claude", ".cursor"]) {
      expect(
        await readFile(
          path.join(cwd, dir, "skills/prisma-agent-enrollment/SKILL.md"),
          "utf8",
        ),
      ).toContain("prisma.approval.resolved");
    }
    const before = await readFile(path.join(cwd, ".codex/config.toml"), "utf8");
    await install(cwd);
    expect(await readFile(path.join(cwd, ".codex/config.toml"), "utf8")).toBe(
      before,
    );
  });
  it("preserves other servers and comments when installing one client", async () => {
    const cwd = await project();
    await mkdir(path.join(cwd, ".codex"));
    await writeFile(
      path.join(cwd, ".codex/config.toml"),
      '# Project settings\n[mcp_servers.docs]\nurl = "https://example.com/mcp"\n',
    );
    await install(cwd, ["--client", "codex"]);
    expect(
      await readFile(path.join(cwd, ".codex/config.toml"), "utf8"),
    ).toContain("# Project settings");
    expect(
      parseToml(await readFile(path.join(cwd, ".codex/config.toml"), "utf8")),
    ).toMatchObject({
      mcp_servers: {
        docs: { url: "https://example.com/mcp" },
        prisma: { url: "https://mcp.prisma.io/mcp" },
      },
    });
    await expect(readFile(path.join(cwd, ".mcp.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("refuses conflicting credentials before writing any client files", async () => {
    const cwd = await project();
    const content = JSON.stringify({
      mcpServers: {
        prisma: {
          url: "https://mcp.prisma.io/mcp",
          headers: { Authorization: "test-placeholder" },
        },
      },
    });
    await writeFile(path.join(cwd, ".mcp.json"), content);
    await expect(install(cwd)).rejects.toMatchObject({ code: 2 });
    expect(await readFile(path.join(cwd, ".mcp.json"), "utf8")).toBe(content);
    await expect(
      readFile(path.join(cwd, ".codex/config.toml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses user-owned skills and linked directories", async () => {
    const cwd = await project();
    await mkdir(path.join(cwd, ".agents/skills/prisma-agent-enrollment"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, ".agents/skills/prisma-agent-enrollment/SKILL.md"),
      "My instructions",
    );
    await expect(install(cwd, ["--client", "codex"])).rejects.toMatchObject({
      code: 2,
    });
    await rm(path.join(cwd, ".agents"), { recursive: true });
    const other = await project();
    await symlink(other, path.join(cwd, ".codex"));
    await expect(install(cwd, ["--client", "codex"])).rejects.toMatchObject({
      code: 2,
    });
    await expect(
      readFile(path.join(other, "config.toml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
