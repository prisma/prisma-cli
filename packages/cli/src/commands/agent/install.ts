// biome-ignore-all lint/performance/noAwaitInLoops: parent checks and file writes must finish in order.
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { defineCommand, flag } from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { Result } from "better-result";
import {
  applyEdits,
  modify,
  type ParseError,
  parse as parseJson,
} from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parseSkillStamp } from "../../lib/skills/frontmatter";

const CLIENTS = {
  codex: { config: ".codex/config.toml", skills: ".agents/skills" },
  claude: { config: ".mcp.json", skills: ".claude/skills" },
  pi: { config: ".pi/mcp.json", skills: ".pi/skills" },
  cursor: { config: ".cursor/mcp.json", skills: ".cursor/skills" },
} as const;

/** Reads only regular project files, including their parent directories. */
async function readInstallTarget(cwd: string, relative: string) {
  return Result.tryPromise({
    try: async () => {
      const parts = relative.split(`/`);
      for (let i = 1; i <= parts.length; i++) {
        const target = path.join(cwd, ...parts.slice(0, i));
        const info = await lstat(target).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          },
        );
        if (info?.isSymbolicLink())
          throw new CliStructuredError(
            "CLI.AGENT_INSTALL_CONFLICT",
            `${relative} contains a symbolic link. Choose a project-local file before installing.`,
          );
        if (!info) return null;
      }
      return await readFile(path.join(cwd, relative), "utf8");
    },
    catch: (error) =>
      error instanceof CliStructuredError
        ? error
        : new CliStructuredError(
            "CLI.AGENT_INSTALL_IO",
            `Could not read ${relative}. Check its permissions and rerun agent install.`,
          ),
  });
}

function parseMcpConfiguration(
  client: keyof typeof CLIENTS,
  original: string | null,
  file: string,
) {
  return Result.try({
    try: () => {
      const errors: ParseError[] = [];
      let document: unknown = {};
      if (original)
        document =
          client === "codex"
            ? parseToml(original)
            : parseJson(original, errors);
      if (
        errors.length ||
        !document ||
        typeof document !== `object` ||
        Array.isArray(document)
      )
        throw new TypeError(`Invalid MCP configuration`);
      const key = client === `codex` ? `mcp_servers` : `mcpServers`;
      const servers = (document as Record<string, unknown>)[key];
      if (servers === undefined) return undefined;
      if (!servers || typeof servers !== `object` || Array.isArray(servers))
        throw new TypeError(`Invalid MCP servers`);
      return (servers as Record<string, unknown>).prisma;
    },
    catch: () =>
      new CliStructuredError(
        `CLI.AGENT_INSTALL_CONFIG`,
        `Could not parse ${file}. Fix the configuration and rerun agent install.`,
      ),
  });
}

function matchesMcpConnection(
  existing: unknown,
  expected: Record<string, unknown>,
): boolean {
  if (!existing || typeof existing !== "object" || Array.isArray(existing))
    return false;
  const server = existing as Record<string, unknown>;
  return (
    Object.keys(server).every((field) => field in expected) &&
    Object.entries(expected).every(([field, value]) => server[field] === value)
  );
}

async function prepareMcpConfiguration(
  cwd: string,
  client: keyof typeof CLIENTS,
  url: string,
) {
  const changes: Array<{ file: string; content: string }> = [];
  const { config } = CLIENTS[client];
  const original = await readInstallTarget(cwd, config);
  if (original.isErr()) return Result.err(original.error);
  const parsed = parseMcpConfiguration(client, original.value, config);
  if (parsed.isErr()) return Result.err(parsed.error);
  const existing = parsed.value;
  const key = client === "codex" ? "mcp_servers" : "mcpServers";
  if (existing !== undefined) {
    const expected = client === "claude" ? { type: "http", url } : { url };
    if (!matchesMcpConnection(existing, expected))
      return Result.err(
        new CliStructuredError(
          "CLI.AGENT_INSTALL_CONFLICT",
          `The Prisma connection in ${config} differs from this installation. Review it before rerunning agent install.`,
        ),
      );
    return Result.ok(changes);
  }
  const server = client === "claude" ? { type: "http", url } : { url };
  const originalText = original.value ?? "{}\n";
  const content =
    client === "codex"
      ? `${original.value ?? ""}\n[mcp_servers.prisma]\nurl = ${JSON.stringify(url)}\n`
      : applyEdits(
          originalText,
          modify(originalText, [key, "prisma"], server, {
            formattingOptions: {
              insertSpaces: true,
              tabSize: 2,
              eol: "\n",
            },
          }),
        );
  const proposed = parseMcpConfiguration(client, content, config);
  if (proposed.isErr())
    return Result.err(
      new CliStructuredError(
        `CLI.AGENT_INSTALL_CONFIG`,
        `Could not extend ${config} safely. Convert inline MCP tables to normal TOML tables and rerun agent install.`,
      ),
    );
  changes.push({ file: config, content });
  return Result.ok(changes);
}

async function prepareClient(
  cwd: string,
  client: keyof typeof CLIENTS,
  url: string,
  enrollmentSkill: string,
) {
  const configuration = await prepareMcpConfiguration(cwd, client, url);
  if (configuration.isErr()) return Result.err(configuration.error);
  const changes = configuration.value;
  const skills = CLIENTS[client].skills;
  const skillFile = `${skills}/prisma-agent-enrollment/SKILL.md`;
  const skill = await readInstallTarget(cwd, skillFile);
  if (skill.isErr()) return Result.err(skill.error);
  if (skill.value !== null && parseSkillStamp(skill.value).library !== "prisma")
    return Result.err(
      new CliStructuredError(
        "CLI.AGENT_INSTALL_CONFLICT",
        `${skillFile} is not a Prisma-managed skill. Move it before rerunning agent install.`,
      ),
    );
  if (skill.value !== enrollmentSkill)
    changes.push({ file: skillFile, content: enrollmentSkill });

  return Result.ok(changes);
}

export const agentInstallCommand = defineCommand({
  help: {
    summary:
      "Install the Prisma MCP connection and enrollment skill in this project",
    description:
      "Run this before connecting your AI agent to Prisma. Your MCP client handles sign-in and stores the credential. The command preserves other MCP servers and refuses conflicting Prisma configuration. Restart your client after installation, then ask it to connect to Prisma.",
    examples: ["agent install", "agent install --client codex"],
  },
  args: {
    flags: {
      client: flag.enum({
        brief: "Configure one MCP client, or all supported clients",
        values: ["all", "codex", "claude", "pi", "cursor"],
        default: "all",
      }),
      url: flag.string({
        brief: "Use another HTTPS MCP endpoint, such as a preview server",
        default: "https://mcp.prisma.io/mcp",
      }),
    },
  },
  handler: async (args, ctx) => {
    const endpoint = Result.try({
      try: () => new URL(args.flags.url ?? "https://mcp.prisma.io/mcp"),
      catch: () =>
        new CliStructuredError(
          "CLI.INVALID_ARGUMENTS",
          "--url must be an HTTPS MCP URL without credentials or a fragment.",
        ),
    });
    if (endpoint.isErr()) return notOk(endpoint.error);
    if (
      endpoint.value.protocol !== "https:" ||
      endpoint.value.username ||
      endpoint.value.password ||
      endpoint.value.hash
    )
      return notOk(
        new CliStructuredError(
          "CLI.INVALID_ARGUMENTS",
          "--url must be an HTTPS MCP URL without credentials or a fragment.",
        ),
      );
    const url = endpoint.value.href;
    const clients =
      args.flags.client === "all" || !args.flags.client
        ? (Object.keys(CLIENTS) as Array<keyof typeof CLIENTS>)
        : [args.flags.client];
    const enrollmentSkill = import.meta.url.endsWith(`.ts`)
      ? await readFile(
          new URL(
            `../../../../../skills/prisma-agent-enrollment/SKILL.md`,
            import.meta.url,
          ),
          `utf8`,
        )
      : (
          await import(
            `../../../../../skills/prisma-agent-enrollment/SKILL.md?raw`
          )
        ).default;
    const changes: Array<{ file: string; content: string }> = [];
    const prepared = await Promise.all(
      clients.map((client) =>
        prepareClient(ctx.cwd, client, url, enrollmentSkill),
      ),
    );
    for (const result of prepared) {
      if (result.isErr()) return notOk(result.error);
      changes.push(...result.value);
    }
    const written = await Result.tryPromise({
      try: async () => {
        for (const change of changes) {
          const target = path.join(ctx.cwd, change.file);
          await mkdir(path.dirname(target), { recursive: true });
          const info = await lstat(target).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === `ENOENT`) return null;
              throw error;
            },
          );
          const temporary = `${target}.${randomUUID()}.tmp`;
          try {
            await using file = await open(temporary, `wx`, info?.mode ?? 0o644);
            await file.writeFile(change.content, `utf8`);
            if (info) await file.chmod(info.mode);
            await file.sync();
            await file.close();
            await rename(temporary, target);
          } finally {
            await rm(temporary, { force: true });
          }
        }
      },
      catch: () =>
        new CliStructuredError(
          "CLI.AGENT_INSTALL_IO",
          "Could not finish installing the agent connection. Check project permissions and rerun agent install.",
        ),
    });
    if (written.isErr()) return notOk(written.error);
    const data = {
      url,
      clients,
      changedFiles: changes.map((change) => change.file),
    };
    return ok(
      ctx.present(
        { data },
        {
          json: () => data,
          stdout: () => [],
          human: () => [
            {
              kind: "summary",
              status: "ok",
              text: changes.length
                ? "Installed the Prisma agent connection."
                : "The Prisma agent connection is already installed.",
            },
            {
              kind: "fields",
              rows: [
                { label: "clients", value: clients.join(", ") },
                { label: "MCP", value: url },
              ],
            },
          ],
          next: () => [
            {
              kind: "user-choice",
              label:
                "Restart your MCP client, then ask your agent to connect to Prisma and finish signing in.",
            },
          ],
        },
      ),
    );
  },
});
