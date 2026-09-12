/**
 * `--format markdown`: the same blocks a command describes for human,
 * rendered as plain Markdown on stdout for a reader that is a model.
 * Every byte here is pinned by the slice spec
 * (.drive/projects/prisma-cli-v8/specs/markdown-format.md).
 */
import {
  type Block,
  defineCommand,
  defineCommandFamily,
  defineConfigSection,
  exitWithChildStatus,
  type Ui,
} from "@prisma/cli-engine";
import {
  CliStructuredError,
  type Diagnostic,
  type NextAction,
  notOk,
  ok,
} from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

interface Fixture {
  readonly blocks?: readonly Block[] | ((ui: Ui) => readonly Block[]);
  readonly next?: readonly NextAction[];
  readonly diagnostics?: readonly Diagnostic[];
  readonly stdout?: readonly string[];
}

function show(fixture: Fixture, calls?: { human: number; stdout: number }) {
  return defineCommand({
    help: { summary: "Render the fixture" },
    handler: async (_args, ctx) =>
      ok(
        ctx.present(
          { data: null, diagnostics: fixture.diagnostics },
          {
            human: (ui) => {
              if (calls !== undefined) {
                calls.human += 1;
              }
              const blocks = fixture.blocks ?? [];
              return typeof blocks === "function" ? blocks(ui) : blocks;
            },
            stdout: () => {
              if (calls !== undefined) {
                calls.stdout += 1;
              }
              return fixture.stdout ?? ["raw data line"];
            },
            json: () => null,
            next: () => fixture.next ?? [],
          },
        ),
      ),
  });
}

async function run(fixture: Fixture, argv: readonly string[] = []) {
  return createTestCli({ commands: { show: show(fixture) } }).run(
    ["show", "--format", "markdown", ...argv],
    { isTty: { stdout: true, stderr: true }, columns: { stderr: 40 } },
  );
}

async function render(blocks: readonly Block[]): Promise<string> {
  return (await run({ blocks })).stdout;
}

describe("block kinds", () => {
  test("summary is `[status] text`, tone ignored", async () => {
    expect(
      await render([
        { kind: "summary", status: "ok", tone: "warn", text: "Signed in" },
      ]),
    ).toBe("[ok] Signed in\n");
  });

  test("fields are `label: value`; empty is the dash, sensitive is the mask, multi-line is verbatim, rail is ignored", async () => {
    expect(
      await render([
        {
          kind: "fields",
          rail: true,
          rows: [
            { label: "status", value: "signed in" },
            { label: "workspace", value: "" },
            { label: "token", value: "tok_secret", sensitive: true },
            { label: "note", value: "first\nsecond" },
          ],
        },
      ]),
    ).toBe(
      "status: signed in\nworkspace: —\ntoken: ********\nnote: first\nsecond\n",
    );
  });

  test("an empty fields block renders nothing", async () => {
    expect(await render([{ kind: "fields", rows: [] }])).toBe("");
  });

  test("table is a GFM pipe table with sentence-cased headers and the dash for an empty cell", async () => {
    expect(
      await render([
        {
          kind: "table",
          columns: ["name", "id", "status"],
          rows: [
            ["Acme Inc", "ws_1", "current"],
            ["Globex", "ws_2", ""],
          ],
        },
      ]),
    ).toBe(
      "| Name | Id | Status |\n" +
        "| --- | --- | --- |\n" +
        "| Acme Inc | ws_1 | current |\n" +
        "| Globex | ws_2 | — |\n",
    );
  });

  test("a pipe in a cell is escaped and a newline becomes a space", async () => {
    expect(
      await render([
        {
          kind: "table",
          columns: ["expr", "note"],
          rows: [["a | b", "line one\nline two"]],
        },
      ]),
    ).toBe("| Expr | Note |\n| --- | --- |\n| a \\| b | line one line two |\n");
  });

  test("a table with columns but no rows prints the header, the separator, then `(no rows)`", async () => {
    expect(
      await render([{ kind: "table", columns: ["name", "id"], rows: [] }]),
    ).toBe("| Name | Id |\n| --- | --- |\n(no rows)\n");
  });

  test("list is one `- item` per entry, multi-line verbatim", async () => {
    expect(await render([{ kind: "list", items: ["one", "two\nmore"] }])).toBe(
      "- one\n- two\nmore\n",
    );
  });

  test("tree is nested bullets, two spaces per depth, status in brackets", async () => {
    expect(
      await render([
        {
          kind: "tree",
          roots: [
            {
              label: "root",
              status: "ok",
              children: [
                { label: "child" },
                {
                  label: "failing",
                  status: "error",
                  children: [{ label: "leaf", status: "warn" }],
                },
              ],
            },
            { label: "second" },
          ],
        },
      ]),
    ).toBe(
      "- [ok] root\n" +
        "  - child\n" +
        "  - [error] failing\n" +
        "    - [warn] leaf\n" +
        "- second\n",
    );
  });

  test("drawing is a fenced code block with no language", async () => {
    expect(await render([{ kind: "drawing", lines: ["│ a", "└─ b"] }])).toBe(
      "```\n│ a\n└─ b\n```\n",
    );
  });

  test("a drawing containing three backticks uses a four-backtick fence", async () => {
    expect(
      await render([{ kind: "drawing", lines: ["```", "x", "```"] }]),
    ).toBe("````\n```\nx\n```\n````\n");
  });

  test("spans render as their plain text with tones dropped", async () => {
    expect(
      await render([
        {
          kind: "summary",
          status: "info",
          text: [
            { text: "Acme", tone: "identifier" },
            { text: " is current", tone: "muted" },
          ],
        },
      ]),
    ).toBe("[info] Acme is current\n");
  });
});

describe("sections", () => {
  test("blocks, then `### Next`, then `### Diagnostics`, one blank line between every block and section, one trailing newline", async () => {
    const result = await run({
      blocks: [
        { kind: "summary", status: "ok", text: "Done" },
        { kind: "fields", rows: [] },
        { kind: "list", items: ["a", "b"] },
      ],
      next: [
        { kind: "run-command", label: "Deploy", command: "prisma deploy" },
      ],
      diagnostics: [
        {
          code: "TOY.SLOW",
          severity: "warn",
          summary: "That took a while",
          nextActions: [],
        },
        {
          code: "TOY.NOTE",
          severity: "info",
          summary: "Just so you know",
          nextActions: [],
        },
      ],
    });

    expect(result.stdout).toBe(
      "[ok] Done\n" +
        "\n" +
        "- a\n" +
        "- b\n" +
        "\n" +
        "### Next\n" +
        "- Deploy: `prisma deploy`\n" +
        "\n" +
        "### Diagnostics\n" +
        "[warn] TOY.SLOW: That took a while\n" +
        "\n" +
        "[info] TOY.NOTE: Just so you know\n",
    );
    expect(result.exitCode).toBe(0);
  });

  test("no next actions and no diagnostics means no headings", async () => {
    expect(
      (await run({ blocks: [{ kind: "summary", status: "ok", text: "Done" }] }))
        .stdout,
    ).toBe("[ok] Done\n");
  });
});

describe("next action bullets", () => {
  async function bullets(next: readonly NextAction[]): Promise<string> {
    return (await run({ next })).stdout;
  }

  test("a command whose label differs: `- label: `command``", async () => {
    expect(
      await bullets([
        { kind: "run-command", label: "Deploy it", command: "prisma deploy" },
      ]),
    ).toBe("### Next\n- Deploy it: `prisma deploy`\n");
  });

  test("a url whose label differs: `- label: url`, verbatim", async () => {
    expect(
      await bullets([
        {
          kind: "open-url",
          label: "Open the console",
          url: "https://console.example.test/x?y=1",
        },
      ]),
    ).toBe(
      "### Next\n- Open the console: https://console.example.test/x?y=1\n",
    );
  });

  test("a label equal to its command is printed once, in backticks", async () => {
    expect(
      await bullets([
        {
          kind: "run-command",
          label: "prisma deploy",
          command: "prisma deploy",
        },
      ]),
    ).toBe("### Next\n- `prisma deploy`\n");
  });

  test("a label equal to its url is printed once, plain", async () => {
    expect(
      await bullets([
        { kind: "open-url", label: "https://x.test", url: "https://x.test" },
      ]),
    ).toBe("### Next\n- https://x.test\n");
  });

  test("no target: `- label`; reason is not rendered", async () => {
    expect(
      await bullets([
        { kind: "user-choice", label: "Pick a region", reason: "latency" },
      ]),
    ).toBe("### Next\n- Pick a region\n");
  });

  test("plural commands: the label, then one nested bullet per command", async () => {
    expect(
      await bullets([
        {
          kind: "run-command",
          label: "Run both",
          commands: ["prisma generate", "prisma migrate deploy"],
        },
      ]),
    ).toBe(
      "### Next\n- Run both\n  - `prisma generate`\n  - `prisma migrate deploy`\n",
    );
  });
});

describe("diagnostic shape", () => {
  async function diagnostic(diagnostic: Diagnostic): Promise<string> {
    return (await run({ diagnostics: [diagnostic] })).stdout;
  }

  test("severity, code, summary, why, where, next actions, docs", async () => {
    expect(
      await diagnostic({
        code: "TOY.STALE",
        severity: "warn",
        summary: "Schema is stale",
        why: "The file changed after the last generate",
        where: { path: "prisma/schema.prisma", line: 12 },
        nextActions: [
          {
            kind: "run-command",
            label: "Regenerate",
            command: "prisma generate",
          },
          { kind: "user-choice", label: "Or ignore it" },
        ],
        docsUrl: "https://docs.test/stale",
      }),
    ).toBe(
      "### Diagnostics\n" +
        "[warn] TOY.STALE: Schema is stale\n" +
        "why: The file changed after the last generate\n" +
        "where: prisma/schema.prisma:12\n" +
        "- Regenerate: `prisma generate`\n" +
        "- Or ignore it\n" +
        "docs: https://docs.test/stale\n",
    );
  });

  test("where with a path alone", async () => {
    expect(
      await diagnostic({
        code: "TOY.A",
        severity: "info",
        summary: "s",
        where: { path: "a.ts" },
        nextActions: [],
      }),
    ).toBe("### Diagnostics\n[info] TOY.A: s\nwhere: a.ts\n");
  });

  test("where with a line alone", async () => {
    expect(
      await diagnostic({
        code: "TOY.A",
        severity: "info",
        summary: "s",
        where: { line: 7 },
        nextActions: [],
      }),
    ).toBe("### Diagnostics\n[info] TOY.A: s\nwhere: line 7\n");
  });

  test("an empty where renders no line", async () => {
    expect(
      await diagnostic({
        code: "TOY.A",
        severity: "info",
        summary: "s",
        where: {},
        nextActions: [],
      }),
    ).toBe("### Diagnostics\n[info] TOY.A: s\n");
  });

  test("docsUrl is derived from the family's docsBaseUrl", async () => {
    const finding = show({
      diagnostics: [
        {
          code: "TOY.FOUND",
          severity: "info",
          summary: "Found",
          nextActions: [],
        },
      ],
    });
    const family = defineCommandFamily({
      commands: { finding },
      docsBaseUrl: "https://pris.ly/cli/errors",
    });
    const result = await createTestCli({
      commandFamilies: [family],
      commands: { finding },
    }).run(["finding", "--format", "markdown"]);

    expect(result.stdout).toBe(
      "### Diagnostics\n[info] TOY.FOUND: Found\ndocs: https://pris.ly/cli/errors/TOY.FOUND\n",
    );
  });
});

describe("selection and channels", () => {
  test("`--format=markdown` is accepted too", async () => {
    const result = await createTestCli({
      commands: {
        show: show({ blocks: [{ kind: "summary", status: "ok", text: "Hi" }] }),
      },
    }).run(["show", "--format=markdown"]);

    expect(result.stdout).toBe("[ok] Hi\n");
  });

  test("everything goes to stdout and stderr stays empty; the stdout lines are never printed", async () => {
    const result = await run({
      blocks: [{ kind: "summary", status: "ok", text: "Done" }],
      next: [{ kind: "user-choice", label: "Next" }],
      diagnostics: [
        { code: "TOY.N", severity: "info", summary: "n", nextActions: [] },
      ],
      stdout: ["raw data line"],
    });

    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("raw data line");
    expect(result.presented?.presentation.stdout).toEqual([]);
    expect(result.presented?.presentation.json).toBeUndefined();
  });

  test("the human thunk is called once and the stdout thunk never; the blocks equal the human run's", async () => {
    const blocks: readonly Block[] = [
      { kind: "summary", status: "ok", text: "Done" },
      {
        kind: "table",
        columns: ["name"],
        rows: [[[{ text: "Acme", tone: "identifier" }]]],
      },
    ];
    const markdownCalls = { human: 0, stdout: 0 };
    const humanCalls = { human: 0, stdout: 0 };
    const markdown = await createTestCli({
      commands: { show: show({ blocks }, markdownCalls) },
    }).run(["show", "--format", "markdown"]);
    const human = await createTestCli({
      commands: { show: show({ blocks }, humanCalls) },
    }).run(["show", "--format", "human"]);

    expect(markdownCalls).toEqual({ human: 1, stdout: 0 });
    expect(humanCalls.human).toBe(1);
    expect(markdown.presented?.presentation.human).toEqual(
      human.presented?.presentation.human,
    );
    expect(markdown.presented?.presentation.next).toEqual([]);
  });

  test("colour is off even with --color, and Ui.code keeps its backticks", async () => {
    const result = await run(
      {
        blocks: (ui) => [
          {
            kind: "summary",
            status: "ok",
            text: `${ui.tone("error", "red")} ${ui.emphasize("bold")} ${ui.dim("dim")} ${ui.code("x")}`,
          },
        ],
      },
      ["--color"],
    );

    expect(result.stdout).toBe("[ok] red bold dim `x`\n");
    expect(result.stderr).toBe("");
  });

  test("Ui.width is unbounded even when stderr is a sized terminal", async () => {
    const result = await run({
      blocks: (ui) => [
        { kind: "summary", status: "info", text: String(ui.width) },
      ],
    });

    expect(result.stdout).toBe("[info] Infinity\n");
  });
});

describe("an errored run", () => {
  const failing = defineCommand({
    help: { summary: "Always fails" },
    handler: async () =>
      notOk(
        new CliStructuredError("TOY.BROKEN", "It broke", {
          why: "The toy always breaks.",
          where: { path: "toy.ts", line: 3 },
          nextActions: [
            { kind: "run-command", label: "Retry", command: "prisma toy" },
            { kind: "open-url", label: "Read more", url: "https://x.test/a" },
          ],
          diagnostics: [
            {
              code: "TOY.FIRST",
              severity: "warn",
              summary: "First finding",
              nextActions: [],
            },
            {
              code: "TOY.SECOND",
              severity: "info",
              summary: "Second finding",
              why: "Because",
              nextActions: [],
            },
          ],
        }),
      ),
  });

  test("the error shape, a blank line, `### Diagnostics`, on stdout, exit 2, stderr empty", async () => {
    const family = defineCommandFamily({
      commands: { failing },
      docsBaseUrl: "https://pris.ly/cli/errors/",
    });
    const result = await createTestCli({
      commandFamilies: [family],
      commands: { failing },
    }).run(["failing", "--format", "markdown", "--color"], {
      isTty: { stdout: true, stderr: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "[error] TOY.BROKEN: It broke\n" +
        "why: The toy always breaks.\n" +
        "where: toy.ts:3\n" +
        "- Retry: `prisma toy`\n" +
        "- Read more: https://x.test/a\n" +
        "docs: https://pris.ly/cli/errors/TOY.BROKEN\n" +
        "\n" +
        "### Diagnostics\n" +
        "[warn] TOY.FIRST: First finding\n" +
        "docs: https://pris.ly/cli/errors/TOY.FIRST\n" +
        "\n" +
        "[info] TOY.SECOND: Second finding\n" +
        "why: Because\n" +
        "docs: https://pris.ly/cli/errors/TOY.SECOND\n",
    );
  });

  test("an error with no accompanying diagnostics prints the error shape alone", async () => {
    const bare = defineCommand({
      help: { summary: "Fails plainly" },
      handler: async () => notOk(new CliStructuredError("TOY.PLAIN", "Nope")),
    });
    const result = await createTestCli({ commands: { bare } }).run([
      "bare",
      "--format",
      "markdown",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("[error] TOY.PLAIN: Nope\n");
    expect(result.stderr).toBe("");
  });

  test("an unknown command prints the engine's usage error on stdout", async () => {
    const result = await createTestCli({ commands: { show: show({}) } }).run([
      "shw",
      "--format",
      "markdown",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "[error] CLI.UNKNOWN_COMMAND: No command registered for `shw`, did you mean `show`?\n" +
        "- Did you mean: `prisma-test show`\n" +
        "- List every command: `prisma-test --help`\n",
    );
  });
});

describe("--version", () => {
  test("prints the bare version on stdout", async () => {
    const result = await createTestCli({ commands: { show: show({}) } }).run(
      ["--version", "--format", "markdown"],
      { isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0.0.0\n");
    expect(result.stderr).toBe("");
  });
});

describe("a child-status settlement", () => {
  const hinting = defineCommand({
    help: { summary: "A converge that asks for a reproduce hint" },
    maySpawn: true,
    handler: async (_args, ctx) => {
      await ctx.spawn({ command: "alchemy" });
      return ok(
        exitWithChildStatus({
          nextActions: [
            {
              kind: "run-command",
              label: "Reproduce the failed converge",
              command: "alchemy deploy ./entry.ts",
            },
            { kind: "user-choice", label: "Or give up" },
          ],
        }),
      );
    },
  });

  test("prints its next actions as bullets on stdout and exits with the child's code", async () => {
    const result = await createTestCli({
      commands: { hinting },
      spawnScript: () => ({ exitCode: 3, signal: null }),
    }).run(["hinting", "--format", "markdown"], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "- Reproduce the failed converge: `alchemy deploy ./entry.ts`\n- Or give up\n",
    );
  });

  test("a signal-killed child prints nothing", async () => {
    const result = await createTestCli({
      commands: { hinting },
      spawnScript: () => ({ exitCode: null, signal: "SIGINT" }),
    }).run(["hinting", "--format", "markdown"], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(130);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

describe("live events", () => {
  const noisy = defineCommand({
    help: { summary: "Emits the whole vocabulary" },
    handler: async (_args, ctx) => {
      ctx.report({ kind: "step-started", step: "compile", id: "s1" });
      ctx.report({ kind: "progress", step: "compile", completed: 1, total: 2 });
      ctx.report({
        kind: "step-finished",
        step: "compile",
        id: "s1",
        outcome: "ok",
      });
      ctx.report({ kind: "step-finished", step: "lint", outcome: "warning" });
      ctx.report({ kind: "step-finished", step: "test", outcome: "failed" });
      ctx.report({ kind: "step-finished", step: "docs", outcome: "skipped" });
      ctx.report({ kind: "message", severity: "warn", text: "heads up" });
      ctx.report({ kind: "message", severity: "info", text: "fyi" });
      ctx.report({ kind: "message", severity: "verbose", text: "chatter" });
      ctx.report({
        kind: "output",
        source: "generator",
        channel: "data",
        line: "generated 3 files",
      });
      ctx.report({
        kind: "output",
        source: "generator",
        channel: "diagnostic",
        line: "generator warmed up",
      });
      ctx.report({
        kind: "remediation",
        action: { kind: "run-command", label: "Review", command: "demo show" },
      });
      ctx.report({
        kind: "endpoint",
        name: "studio",
        url: "http://localhost:5555",
      });
      ctx.report({
        kind: "status",
        subject: "db",
        status: "ready",
        from: "starting",
      });
      ctx.report({ kind: "status", subject: "cache", status: "warm" });
      ctx.report({
        kind: "artifact",
        path: "out/contract.json",
        description: "the contract",
        data: { bytes: 42 },
      });
      ctx.report({ kind: "artifact", path: "out/plain.json" });
      return ok(
        ctx.present(
          { data: null },
          {
            human: () => [{ kind: "summary", status: "ok", text: "Done" }],
            stdout: () => [],
            json: () => null,
            next: () => [],
          },
        ),
      );
    },
  });

  test("started and progress are dropped, finished carries the outcome word, the rest print as human, all on stdout", async () => {
    const result = await createTestCli({ commands: { noisy } }).run(
      ["noisy", "--format", "markdown"],
      { isTty: { stdout: true, stderr: true } },
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "[ok] compile\n" +
        "[warning] lint\n" +
        "[failed] test\n" +
        "[skipped] docs\n" +
        "heads up\n" +
        "fyi\n" +
        "generated 3 files\n" +
        "generator warmed up\n" +
        "studio: http://localhost:5555\n" +
        "db: starting → ready\n" +
        "cache: warm\n" +
        "out/contract.json — the contract\n" +
        "out/plain.json\n" +
        "[ok] Done\n",
    );
  });

  test("the log-level filter applies as under human", async () => {
    const result = await createTestCli({ commands: { noisy } }).run([
      "noisy",
      "--format",
      "markdown",
      "--quiet",
    ]);

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("generated 3 files\n[ok] Done\n");
  });
});

describe("config-section warnings", () => {
  interface ToyConfig {
    readonly greeting: string;
  }
  const warningSection = defineConfigSection<ToyConfig>({
    name: "toy",
    validate: () => ({
      ok: true,
      value: { greeting: "hi" },
      diagnostics: [
        {
          code: "TOY.LEGACY_GREETING",
          severity: "warn",
          summary: "toy.legacy is deprecated.",
          why: "Use toy.greeting.",
          nextActions: [],
        },
        {
          code: "TOY.FYI",
          severity: "info",
          summary: "Nothing to do.",
          nextActions: [],
        },
      ],
    }),
  });
  const warned = defineCommand({
    help: { summary: "Show the validated toy config" },
    needs: { config: warningSection },
    handler: async (_args, ctx) =>
      ok(
        ctx.present(
          { data: ctx.config },
          {
            human: () => [
              { kind: "summary", status: "ok", text: ctx.config.greeting },
            ],
            stdout: () => [],
            json: () => ctx.config,
            next: () => [],
          },
        ),
      ),
  });

  function cli() {
    return createTestCli({ commands: { warned }, config: { toy: {} } });
  }

  test("print on stdout in the diagnostic shape, a blank line between them, before the blocks", async () => {
    const result = await cli().run(["warned", "--format", "markdown"], {
      isTty: { stdout: true, stderr: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "[warn] TOY.LEGACY_GREETING: toy.legacy is deprecated.\n" +
        "why: Use toy.greeting.\n" +
        "\n" +
        "[info] TOY.FYI: Nothing to do.\n" +
        "[ok] hi\n",
    );
  });

  test("the log level filters them as under human", async () => {
    const result = await cli().run([
      "warned",
      "--format",
      "markdown",
      "--log-level",
      "warn",
    ]);

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "[warn] TOY.LEGACY_GREETING: toy.legacy is deprecated.\nwhy: Use toy.greeting.\n[ok] hi\n",
    );
  });
});
