/**
 * Terminal help, byte for byte, captured before help.ts was split into
 * a data model and two renderers. These bytes must not change.
 */
import { describe, expect, test } from "vitest";
import { helpCardsCli } from "./fixtures/help-cards";

describe("terminal help is unchanged by the renderer split", () => {
  test("root card, coloured", async () => {
    const result = await helpCardsCli().run(["--help"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "\u001b[1mprisma-test\u001b[22m \u001b[2m→ The Prisma test CLI\u001b[22m\n\n\u001b[2m│\u001b[22m  \u001b[36mproject\u001b[39m  Manage projects\n\u001b[2m│\u001b[22m  \u001b[36mwhoami\u001b[39m   Show who is signed in\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  Works against a workspace you are signed in to.\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  Every command prints Markdown with --format markdown.\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2mWorkflow\u001b[22m\n\u001b[2m│\u001b[22m    \u001b[2m$\u001b[22m prisma-test whoami        \u001b[2mCheck the session\u001b[22m\n\u001b[2m│\u001b[22m    \u001b[2m$\u001b[22m prisma-test project link  \u001b[2mLink a project\u001b[22m\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2mGlobal options\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[36m    --format\u001b[39m                        Output format \u001b[2mhuman|json|markdown\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[36m    --json\u001b[39m                          Shorthand for --format json\n\u001b[2m│\u001b[22m  \u001b[36m    --log-level\u001b[39m                     Commentary verbosity \u001b[2merror|warn|info|verbose\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[36m-v, --verbose\u001b[39m                       Shorthand for --log-level verbose\n\u001b[2m│\u001b[22m  \u001b[36m-q, --quiet\u001b[39m                         Shorthand for --log-level error\n\u001b[2m│\u001b[22m  \u001b[36m-y, --yes\u001b[39m                           Accept prompt defaults without asking\n\u001b[2m│\u001b[22m  \u001b[36m    --confirm <value>...\u001b[39m            Grant a consent prompt non-interactively by typing its token (repeatable)\n\u001b[2m│\u001b[22m  \u001b[36m    --interactive/--no-interactive\u001b[39m  Force interactive prompts on or off\n\u001b[2m│\u001b[22m  \u001b[36m    --color/--no-color\u001b[39m              Force ANSI color on or off\n\u001b[2m│\u001b[22m  \u001b[36m    --config <path>\u001b[39m                 Read this config file instead of ./prisma.config.ts\n\u001b[2m│\u001b[22m  \u001b[36m-h, --help\u001b[39m                          Print help for a command\n\u001b[2m│\u001b[22m  \u001b[36m    --version\u001b[39m                       Print the CLI version and exit\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2mExamples\u001b[22m\n\u001b[2m│\u001b[22m    \u001b[2m$\u001b[22m prisma-test whoami\n\u001b[2m│\u001b[22m    \u001b[2m$\u001b[22m prisma-test project list --json\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2mDocs\u001b[22m  \u001b[34mhttps://pris.ly/cli\u001b[39m\n\n",
    );
  });

  test("root card, plain", async () => {
    const result = await helpCardsCli().run(["--help", "--no-color"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "prisma-test → The Prisma test CLI\n\n│  project  Manage projects\n│  whoami   Show who is signed in\n│\n│  Works against a workspace you are signed in to.\n│\n│  Every command prints Markdown with --format markdown.\n│\n│  Workflow\n│    $ prisma-test whoami        Check the session\n│    $ prisma-test project link  Link a project\n│\n│  Global options\n│      --format                        Output format human|json|markdown\n│      --json                          Shorthand for --format json\n│      --log-level                     Commentary verbosity error|warn|info|verbose\n│  -v, --verbose                       Shorthand for --log-level verbose\n│  -q, --quiet                         Shorthand for --log-level error\n│  -y, --yes                           Accept prompt defaults without asking\n│      --confirm <value>...            Grant a consent prompt non-interactively by typing its token (repeatable)\n│      --interactive/--no-interactive  Force interactive prompts on or off\n│      --color/--no-color              Force ANSI color on or off\n│      --config <path>                 Read this config file instead of ./prisma.config.ts\n│  -h, --help                          Print help for a command\n│      --version                       Print the CLI version and exit\n│\n│  Examples\n│    $ prisma-test whoami\n│    $ prisma-test project list --json\n│\n│  Docs  https://pris.ly/cli\n\n",
    );
  });

  test("group card, coloured", async () => {
    const result = await helpCardsCli().run(["project", "--help"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "\u001b[1mprisma-test project\u001b[22m \u001b[2m→ Manage projects\u001b[22m\n\n\u001b[2m│\u001b[22m  \u001b[36mlink [id-or-name] [tag...]\u001b[39m  Link this directory to a project\n\u001b[2m│\u001b[22m  \u001b[36mlist\u001b[39m                        List projects in the workspace\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  A project is a named container for databases and their settings.\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2mWorkflow\u001b[22m\n\u001b[2m│\u001b[22m    \u001b[2m$\u001b[22m prisma-test project link         \u001b[2mPick the project this checkout uses\u001b[22m\n\u001b[2m│\u001b[22m    \u001b[2m$\u001b[22m prisma-test project list | head  \u001b[2mSee what else exists\u001b[22m\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2mRun 'prisma-test project <command> --help' for details on a command.\u001b[22m\n\n",
    );
  });

  test("group card, plain", async () => {
    const result = await helpCardsCli().run(
      ["project", "--help", "--no-color"],
      {
        isTty: { stdout: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "prisma-test project → Manage projects\n\n│  link [id-or-name] [tag...]  Link this directory to a project\n│  list                        List projects in the workspace\n│\n│  A project is a named container for databases and their settings.\n│\n│  Workflow\n│    $ prisma-test project link         Pick the project this checkout uses\n│    $ prisma-test project list | head  See what else exists\n│\n│  Run 'prisma-test project <command> --help' for details on a command.\n\n",
    );
  });

  test("leaf card, coloured", async () => {
    const result = await helpCardsCli().run(["project", "link", "--help"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "\u001b[1mprisma-test project link\u001b[22m \u001b[2m→ Link this directory to a project\u001b[22m\n\n\u001b[2m│\u001b[22m  \u001b[2mUsage\u001b[22m\n\u001b[2m│\u001b[22m    \u001b[2m$\u001b[22m \u001b[1mprisma-test project link --workspace <workspace-id> [options] [id-or-name] [tag...]\u001b[22m\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  Writes the project id into prisma.config.ts so later commands know which\n\u001b[2m│\u001b[22m  project you mean.\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  Run it once per checkout. Re-running replaces the link.\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2mArguments\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[36mid-or-name\u001b[39m  The project id or its display name \u001b[2m(optional)\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[36mtag\u001b[39m         Tags to record on the link\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2mOptions\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[36m-r, --region <region>\u001b[39m                 Region to prefer \u001b[2m(default: us)\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[36m    --workspace <workspace-id>\u001b[39m        Workspace the project lives in \u001b[2m(required)\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[36m-f, --force\u001b[39m                           Overwrite an existing link\n\u001b[2m│\u001b[22m  \u001b[36m    --confirm-link/--no-confirm-link\u001b[39m  Confirm or skip the link prompt\n\u001b[2m│\u001b[22m  \u001b[36m    --mode <value>\u001b[39m                    How to link \u001b[2m(copy|reference; default: copy)\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[36m    --label <label>...\u001b[39m                Labels, a|b style\n\u001b[2m│\u001b[22m  \u001b[36m    --retries <value>\u001b[39m                 How many attempts\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2mGlobal options also apply: --format, --json, --log-level, --verbose,\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2m--quiet, --yes, --confirm, --interactive, --color, --config. Run\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2m'prisma-test --help' for details.\u001b[22m\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2mExamples\u001b[22m\n\u001b[2m│\u001b[22m    \u001b[2m$\u001b[22m prisma-test project link\n\u001b[2m│\u001b[22m    \u001b[2m$\u001b[22m prisma-test project link \"Acme Dashboard\" --region eu\n\u001b[2m│\u001b[22m\n\u001b[2m│\u001b[22m  \u001b[2mDocs\u001b[22m  \u001b[34mhttps://pris.ly/cli/errors\u001b[39m\n\n",
    );
  });

  test("leaf card, plain", async () => {
    const result = await helpCardsCli().run(
      ["project", "link", "--help", "--no-color"],
      {
        isTty: { stdout: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "prisma-test project link → Link this directory to a project\n\n│  Usage\n│    $ prisma-test project link --workspace <workspace-id> [options] [id-or-name] [tag...]\n│\n│  Writes the project id into prisma.config.ts so later commands know which\n│  project you mean.\n│\n│  Run it once per checkout. Re-running replaces the link.\n│\n│  Arguments\n│  id-or-name  The project id or its display name (optional)\n│  tag         Tags to record on the link\n│\n│  Options\n│  -r, --region <region>                 Region to prefer (default: us)\n│      --workspace <workspace-id>        Workspace the project lives in (required)\n│  -f, --force                           Overwrite an existing link\n│      --confirm-link/--no-confirm-link  Confirm or skip the link prompt\n│      --mode <value>                    How to link (copy|reference; default: copy)\n│      --label <label>...                Labels, a|b style\n│      --retries <value>                 How many attempts\n│\n│  Global options also apply: --format, --json, --log-level, --verbose,\n│  --quiet, --yes, --confirm, --interactive, --color, --config. Run\n│  'prisma-test --help' for details.\n│\n│  Examples\n│    $ prisma-test project link\n│    $ prisma-test project link \"Acme Dashboard\" --region eu\n│\n│  Docs  https://pris.ly/cli/errors\n\n",
    );
  });
});
