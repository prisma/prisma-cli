# @prisma/cli-engine

The execution engine of the unified Prisma CLI: it owns the path from argv to exit code — parsing, execution, rendering, and error handling.

Every command describes its output once, as blocks, and the engine renders it in one of three formats chosen by `--format`: `human` for a person at a terminal (padded, aligned, coloured, on stderr, with the machine-usable data lines on stdout), `json` for a program (a stream of frames ending in a result envelope on stdout), and `markdown` for an agent that reads the output as text (plain Markdown with every value labelled, everything on stdout, nothing on stderr). A terminal gets `human` and a pipe gets `json` unless a format is named; `markdown` is only ever explicit.

## Entry points

- `@prisma/cli-engine` — the engine: command definitions, context, and the runner.
- `@prisma/cli-engine/protocol` — the wire types for machine-readable (JSON) output.
- `@prisma/cli-engine/testing` — the test harness for running commands in-process.

## Statement prompts

A command asks what the user means to happen to something with `ctx.prompt.statement`. The answer is a verb and free text, and the command validates it:

```ts
const answer = await ctx.prompt.statement(
  'Table "Legacy" would be dropped and its rows lost. What do you mean?',
  {
    subject: "Legacy",
    verbs: ["rename", "delete"],
    forms: { rename: "Legacy:<new name>" },
    validate: (verb, text) =>
      verb === "rename" && !text.startsWith("Legacy:")
        ? "Write the rename as Legacy:<new name>."
        : undefined,
  },
);
// { verb: "delete", text: "Legacy" } or { verb: "rename", text: "Legacy:Archive" }
```

Each verb is a flag the command family registers with `defineCommandFamily({ ..., statementVerbs: ["rename", "delete"] })`. The engine adds `--rename` and `--delete` to every mounted command, and no command may declare a flag with those names. Asking with a verb no family registered is a construction error.

The engine answers the question in this order:

1. A verb-flag value that names the subject: the value is the subject, or starts with `<subject>:`. `--delete Legacy` and `--rename Legacy:Archive` both name `Legacy`. A value `validate` rejects fails the run with `CLI.PROMPT_INVALID`.
2. With no such value, a non-interactive run, or one under `--yes`, fails with `CLI.CONSENT_REQUIRED`. Its next actions give one flag to pass per verb, and its `meta` carries `subject`, `verbs` and `unanswered`.
3. Otherwise the user is asked, and answers `<verb> <text>`, or `<verb>` alone to mean the subject. A rejected answer is asked again on a terminal; with scripted or piped input it fails with `CLI.PROMPT_INVALID`.

`ctx.prompt.statements([...])` asks several questions at once and returns the answers in order. Flags answer what they can, a refusal lists every question still unanswered, and an interactive run asks the rest one after another.

Each flag value answers one question. A run that succeeds with a verb-flag value nothing consumed fails with `CLI.CONSENT_UNUSED`, so a mistyped subject is never ignored.

Part of [prisma/prisma-cli](https://github.com/prisma/prisma-cli).
