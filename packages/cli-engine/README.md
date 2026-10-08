# @prisma/cli-engine

The execution engine of the unified Prisma CLI: it owns the path from argv to exit code — parsing, execution, rendering, and error handling.

Every command describes its output once, as blocks, and the engine renders it in one of three formats chosen by `--format`: `human` for a person at a terminal (padded, aligned, coloured, on stderr, with the machine-usable data lines on stdout), `json` for a program (a stream of frames ending in a result envelope on stdout), and `markdown` for an agent that reads the output as text (plain Markdown with every value labelled, everything on stdout, nothing on stderr). A terminal gets `human` and a pipe gets `json` unless a format is named; `markdown` is only ever explicit.

## Entry points

- `@prisma/cli-engine` — the engine: command definitions, context, and the runner.
- `@prisma/cli-engine/protocol` — the wire types for machine-readable (JSON) output.
- `@prisma/cli-engine/testing` — the test harness for running commands in-process.

## Statement prompts

A command asks what the user means to happen to something with `ctx.prompt.statement`. The answer is a verb and free text, and the command validates it.

The command declares the verbs it may ask with, each with its `arity` (how many values follow the flag) and a help `brief`:

```ts
defineCommand({
  statements: {
    rename: { arity: 1, brief: "Rename a table instead of dropping it: --rename Old:New" },
    delete: { arity: 1, brief: "Drop a table and its rows: --delete Table" },
  },
  // ...
});
```

Only that command accepts `--rename` and `--delete`; on any other command they are unknown flags. Their values stay out of the handler's flags, and help lists them on the command's own card. A verb is one lowercase word, and may not be a shared flag or one of the command's own flags. Asking with a verb the command did not declare is a construction error, and so is a question with an empty subject or a verb listed twice.

Then, in the handler:

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
// { verb: "delete", text: "Legacy", values: ["Legacy"] }
// or { verb: "rename", text: "Legacy:Archive", values: ["Legacy:Archive"] }
```

Each occurrence of `--<verb>` takes exactly `arity` values, in argv order across all the verbs. A wrong count or an empty value is `CLI.INVALID_ARGUMENTS`. A token that starts with `-` reads as a flag, so a first value that starts with `-` must be written `--<verb>=<value>`. `values` holds them; `text` is them joined by one space.

The engine answers the question in this order:

1. A verb flag whose first value names the subject: the value is the subject, or starts with `<subject>:`. `--delete Legacy` and `--rename Legacy:Archive` both name `Legacy`. Within one batch, a value equal to a subject answers that subject first, and any other value goes to the longest subject it names, so `--delete A:B` answers the question about `A:B`, not the one about `A`. Ask questions whose subjects are prefixes of one another in one batch. A value `validate` rejects fails the run with `CLI.PROMPT_INVALID`.
2. With no such value, a non-interactive run, or one under `--yes`, fails with `CLI.CONSENT_REQUIRED`. Its next actions give one flag to pass per verb, safe to paste into a shell: a value with anything but plain characters is single-quoted, and a value starting with `-` is written `--<verb>=<value>`, and its `meta` carries `subject`, `verbs` and `unanswered`.
3. Otherwise the user is asked, and answers `<verb> <text>`, or `<verb>` alone to mean the subject. A verb with an arity above 1 takes its values from the text, separated by whitespace, and `text` is them joined by one space, as for a flag. A rejected answer is asked again on a terminal; with scripted or piped input it fails with `CLI.PROMPT_INVALID`.

`ctx.prompt.statements([...])` asks several questions at once and returns the answers in order. Flags answer what they can, a refusal lists every question still unanswered, and an interactive run asks the rest one after another.

A statement is the command's own declared input, unlike a `--confirm` value, which a handler never sees. A command that needs some statements as input to its work, before it can know what to ask, takes them with `ctx.statements.take("rename")`: every unconsumed value of that verb, in argv order, as `{ verb, values, text }[]`. Taken values are consumed, and other verbs' values stay for the questions. A later question may still list a taken verb: no flag value of it is left to answer the question, so the verb serves the refusal's `--<verb>` form and what a user may type. `ctx.statements.values()` lists every unconsumed value of every verb in argv order without consuming any, for showing what a run was given, such as in a line that repeats the command. Take before any `last: true` batch, which reports every value still unconsumed.

Each flag answers one question. A run that succeeds with a flag nothing consumed fails with `CLI.CONSENT_UNUSED`, so a mistyped subject or a second answer to one question is never ignored. That check runs when the handler returns, after the command has acted. A command that asks everything in one batch passes `statements(questions, { last: true })` to get the same failure right after the questions are answered, before it does anything with them.

Part of [prisma/prisma-cli](https://github.com/prisma/prisma-cli).
