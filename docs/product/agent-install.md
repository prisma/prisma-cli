# Agent install

`prisma agent install` adds the Prisma remote MCP connection and its enrollment
skill to the current project. It does not sign in, create an API token, or use
the CLI's human credentials. OAuth sign-in happens in the MCP client.

The default configures Codex, Claude Code, Pi, and Cursor. `--client codex`,
`--client claude`, `--client pi`, or `--client cursor` installs only that client. Codex uses
`.codex/config.toml` and `.agents/skills`; Claude Code uses `.mcp.json` and
`.claude/skills`; Pi uses `.pi/mcp.json` and `.pi/skills`; Cursor uses `.cursor/mcp.json` and `.cursor/skills`.

`--url` selects another HTTPS MCP endpoint, for example a preview server.
The production default is `https://mcp.prisma.io/mcp`. No authorization headers
are written. The client handles credential storage and refresh.

The command preserves other MCP servers, comments, and unrelated configuration.
An existing Prisma connection with another URL, headers, or different transport
is refused. Invalid configuration, a symlink target, and an enrollment skill
not owned by Prisma are also refused. It checks every target before writing any
file. Repeating the command with the same endpoint is safe. Codex configurations that
use an inline `mcp_servers` table must be converted to normal TOML tables before
installation. The command validates the proposed configuration before writing it.

Human output lists the configured clients and the next sign-in step. JSON output
returns the endpoint, clients, and changed file paths. Each file is written to a temporary file in the same directory and renamed only
after the write succeeds. Existing file permissions are preserved. Some client
files can remain unchanged if a later file fails; the error says to correct the filesystem problem and
rerun the command. The built-binary filesystem test proves the installation
without requiring a platform credential.

New MCP connections enroll a persistent agent with access to the sponsor's
default workspace. The sponsor can change the workspace list in Console. The
skill prefers native MCP Events for approvals when the client supports them,
and otherwise uses a bounded status check every five seconds.

Pi requires a version with native remote MCP and OAuth support. Run `pi mcp login prisma`
after trusting the project configuration, then `/reload` in an existing session.
See [Pi MCP setup](https://pi.dev/docs/latest/mcp).
