/**
 * Help under `--format markdown`, byte for byte, per the slice spec's
 * help shape (.drive/projects/prisma-cli-v8/specs/markdown-format.md):
 * everything on stdout, stderr empty, colour off.
 */
import { describe, expect, test } from "vitest";
import { helpCardsCli } from "./fixtures/help-cards";

describe("markdown help", () => {
  test("root card via --help", async () => {
    const result = await helpCardsCli().run(
      ["--help", "--format", "markdown"],
      {
        isTty: { stdout: true, stderr: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "# prisma-test\n\nThe Prisma test CLI\n\nWorks against a workspace you are signed in to.\n\nEvery command prints Markdown with --format markdown.\n\n## Commands\n\n| Command | Description |\n| --- | --- |\n| `project` | Manage projects |\n| `whoami` | Show who is signed in |\n\n## Workflow\n\n| Run | Purpose |\n| --- | --- |\n| `prisma-test whoami` | Check the session |\n| `prisma-test project link` | Link a project |\n\n## Global options\n\n| Flag | Description |\n| --- | --- |\n| `--format` | Output format (human\\|json\\|markdown) |\n| `--json` | Shorthand for --format json |\n| `--log-level` | Commentary verbosity (error\\|warn\\|info\\|verbose) |\n| `-v, --verbose` | Shorthand for --log-level verbose |\n| `-q, --quiet` | Shorthand for --log-level error |\n| `-y, --yes` | Accept prompt defaults without asking |\n| `--confirm <value>...` | Grant a consent prompt non-interactively by typing its token (repeatable) |\n| `--interactive/--no-interactive` | Force interactive prompts on or off |\n| `--color/--no-color` | Force ANSI color on or off |\n| `--config <path>` | Read this config file instead of ./prisma.config.ts |\n| `-h, --help` | Print help for a command |\n| `--version` | Print the CLI version and exit |\n\n## Examples\n\n```bash\nprisma-test whoami\nprisma-test project list --json\n```\n\nDocs: https://pris.ly/cli\n",
    );
  });

  test("root card via no argv", async () => {
    const result = await helpCardsCli().run(["--format", "markdown"], {
      isTty: { stdout: true, stderr: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "# prisma-test\n\nThe Prisma test CLI\n\nWorks against a workspace you are signed in to.\n\nEvery command prints Markdown with --format markdown.\n\n## Commands\n\n| Command | Description |\n| --- | --- |\n| `project` | Manage projects |\n| `whoami` | Show who is signed in |\n\n## Workflow\n\n| Run | Purpose |\n| --- | --- |\n| `prisma-test whoami` | Check the session |\n| `prisma-test project link` | Link a project |\n\n## Global options\n\n| Flag | Description |\n| --- | --- |\n| `--format` | Output format (human\\|json\\|markdown) |\n| `--json` | Shorthand for --format json |\n| `--log-level` | Commentary verbosity (error\\|warn\\|info\\|verbose) |\n| `-v, --verbose` | Shorthand for --log-level verbose |\n| `-q, --quiet` | Shorthand for --log-level error |\n| `-y, --yes` | Accept prompt defaults without asking |\n| `--confirm <value>...` | Grant a consent prompt non-interactively by typing its token (repeatable) |\n| `--interactive/--no-interactive` | Force interactive prompts on or off |\n| `--color/--no-color` | Force ANSI color on or off |\n| `--config <path>` | Read this config file instead of ./prisma.config.ts |\n| `-h, --help` | Print help for a command |\n| `--version` | Print the CLI version and exit |\n\n## Examples\n\n```bash\nprisma-test whoami\nprisma-test project list --json\n```\n\nDocs: https://pris.ly/cli\n",
    );
  });

  test("root card via --help-all, --color ignored", async () => {
    const result = await helpCardsCli().run(
      ["--help-all", "--format=markdown", "--color"],
      {
        isTty: { stdout: true, stderr: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "# prisma-test\n\nThe Prisma test CLI\n\nWorks against a workspace you are signed in to.\n\nEvery command prints Markdown with --format markdown.\n\n## Commands\n\n| Command | Description |\n| --- | --- |\n| `project` | Manage projects |\n| `whoami` | Show who is signed in |\n\n## Workflow\n\n| Run | Purpose |\n| --- | --- |\n| `prisma-test whoami` | Check the session |\n| `prisma-test project link` | Link a project |\n\n## Global options\n\n| Flag | Description |\n| --- | --- |\n| `--format` | Output format (human\\|json\\|markdown) |\n| `--json` | Shorthand for --format json |\n| `--log-level` | Commentary verbosity (error\\|warn\\|info\\|verbose) |\n| `-v, --verbose` | Shorthand for --log-level verbose |\n| `-q, --quiet` | Shorthand for --log-level error |\n| `-y, --yes` | Accept prompt defaults without asking |\n| `--confirm <value>...` | Grant a consent prompt non-interactively by typing its token (repeatable) |\n| `--interactive/--no-interactive` | Force interactive prompts on or off |\n| `--color/--no-color` | Force ANSI color on or off |\n| `--config <path>` | Read this config file instead of ./prisma.config.ts |\n| `-h, --help` | Print help for a command |\n| `--version` | Print the CLI version and exit |\n\n## Examples\n\n```bash\nprisma-test whoami\nprisma-test project list --json\n```\n\nDocs: https://pris.ly/cli\n",
    );
  });

  test("group card via --help", async () => {
    const result = await helpCardsCli().run(
      ["project", "--help", "--format", "markdown"],
      {
        isTty: { stdout: true, stderr: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "# prisma-test project\n\nManage projects\n\nA project is a named container for databases and their settings.\n\n## Commands\n\n| Command | Description |\n| --- | --- |\n| `link [id-or-name] [tag...]` | Link this directory to a project |\n| `list` | List projects in the workspace |\n\n## Workflow\n\n| Run | Purpose |\n| --- | --- |\n| `prisma-test project link` | Pick the project this checkout uses |\n| `prisma-test project list \\| head` | See what else exists |\n\nRun 'prisma-test project <command> --help' for details on a command.\n",
    );
  });

  test("group card via a bare group invocation", async () => {
    const result = await helpCardsCli().run(
      ["project", "--format", "markdown"],
      {
        isTty: { stdout: true, stderr: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "# prisma-test project\n\nManage projects\n\nA project is a named container for databases and their settings.\n\n## Commands\n\n| Command | Description |\n| --- | --- |\n| `link [id-or-name] [tag...]` | Link this directory to a project |\n| `list` | List projects in the workspace |\n\n## Workflow\n\n| Run | Purpose |\n| --- | --- |\n| `prisma-test project link` | Pick the project this checkout uses |\n| `prisma-test project list \\| head` | See what else exists |\n\nRun 'prisma-test project <command> --help' for details on a command.\n",
    );
  });

  test("group card via a bare group invocation with --format=markdown", async () => {
    const result = await helpCardsCli().run(["project", "--format=markdown"], {
      isTty: { stdout: true, stderr: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "# prisma-test project\n\nManage projects\n\nA project is a named container for databases and their settings.\n\n## Commands\n\n| Command | Description |\n| --- | --- |\n| `link [id-or-name] [tag...]` | Link this directory to a project |\n| `list` | List projects in the workspace |\n\n## Workflow\n\n| Run | Purpose |\n| --- | --- |\n| `prisma-test project link` | Pick the project this checkout uses |\n| `prisma-test project list \\| head` | See what else exists |\n\nRun 'prisma-test project <command> --help' for details on a command.\n",
    );
  });

  test("leaf card via --help", async () => {
    const result = await helpCardsCli().run(
      ["project", "link", "--help", "--format", "markdown"],
      {
        isTty: { stdout: true, stderr: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "# prisma-test project link\n\nLink this directory to a project\n\n## Usage\n\n```bash\nprisma-test project link --workspace <workspace-id> [options] [id-or-name] [tag...]\n```\n\nWrites the project id into prisma.config.ts so later commands know which project you mean.\n\nRun it once per checkout. Re-running replaces the link.\n\n## Arguments\n\n| Argument | Description |\n| --- | --- |\n| `id-or-name` | The project id or its display name (optional) |\n| `tag` | Tags to record on the link |\n\n## Options\n\n| Flag | Description |\n| --- | --- |\n| `-r, --region <region>` | Region to prefer (default: us) |\n| `--workspace <workspace-id>` | Workspace the project lives in (required) |\n| `-f, --force` | Overwrite an existing link |\n| `--confirm-link/--no-confirm-link` | Confirm or skip the link prompt |\n| `--mode <value>` | How to link (copy\\|reference; default: copy) |\n| `--label <label>...` | Labels, a\\|b style |\n| `--retries <value>` | How many attempts |\n\nGlobal options also apply: --format, --json, --log-level, --verbose, --quiet, --yes, --confirm, --interactive, --color, --config. Run 'prisma-test --help' for details.\n\n## Examples\n\n```bash\nprisma-test project link\nprisma-test project link \"Acme Dashboard\" --region eu\n```\n\nDocs: https://pris.ly/cli/errors\n",
    );
  });

  test("leaf card via -h", async () => {
    const result = await helpCardsCli().run(
      ["project", "link", "-h", "--format", "markdown"],
      {
        isTty: { stdout: true, stderr: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "# prisma-test project link\n\nLink this directory to a project\n\n## Usage\n\n```bash\nprisma-test project link --workspace <workspace-id> [options] [id-or-name] [tag...]\n```\n\nWrites the project id into prisma.config.ts so later commands know which project you mean.\n\nRun it once per checkout. Re-running replaces the link.\n\n## Arguments\n\n| Argument | Description |\n| --- | --- |\n| `id-or-name` | The project id or its display name (optional) |\n| `tag` | Tags to record on the link |\n\n## Options\n\n| Flag | Description |\n| --- | --- |\n| `-r, --region <region>` | Region to prefer (default: us) |\n| `--workspace <workspace-id>` | Workspace the project lives in (required) |\n| `-f, --force` | Overwrite an existing link |\n| `--confirm-link/--no-confirm-link` | Confirm or skip the link prompt |\n| `--mode <value>` | How to link (copy\\|reference; default: copy) |\n| `--label <label>...` | Labels, a\\|b style |\n| `--retries <value>` | How many attempts |\n\nGlobal options also apply: --format, --json, --log-level, --verbose, --quiet, --yes, --confirm, --interactive, --color, --config. Run 'prisma-test --help' for details.\n\n## Examples\n\n```bash\nprisma-test project link\nprisma-test project link \"Acme Dashboard\" --region eu\n```\n\nDocs: https://pris.ly/cli/errors\n",
    );
  });

  test("a --format with no value is still a usage error, not help", async () => {
    const result = await helpCardsCli().run(["project", "--format"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).not.toContain("# prisma-test");
  });

  test("a --format with an unknown value is still a usage error, not help", async () => {
    const result = await helpCardsCli().run(["project", "--format=bogus"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).not.toContain("# prisma-test");
  });

  test("a --format whose value is a command name is still a usage error", async () => {
    const result = await helpCardsCli().run(["--format", "project"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).not.toContain("# prisma-test");
  });

  test("tokens after -- are positionals, so the invocation is not bare", async () => {
    const result = await helpCardsCli().run([
      "project",
      "--format",
      "markdown",
      "--",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).not.toContain("# prisma-test project");
  });
});
