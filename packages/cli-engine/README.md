# @prisma/cli-engine

The execution engine of the unified Prisma CLI: it owns the path from argv to exit code — parsing, execution, rendering, and error handling.

Every command describes its output once, as blocks, and the engine renders it in one of three formats chosen by `--format`: `human` for a person at a terminal (padded, aligned, coloured, on stderr, with the machine-usable data lines on stdout), `json` for a program (a stream of frames ending in a result envelope on stdout), and `markdown` for an agent that reads the output as text (plain Markdown with every value labelled, everything on stdout, nothing on stderr). Without a format flag the format is `human`, whether stdout is a terminal or a pipe: a pipe receives the command's data lines and nothing else. `json` and `markdown` are only ever explicit.

## Entry points

- `@prisma/cli-engine` — the engine: command definitions, context, and the runner.
- `@prisma/cli-engine/protocol` — the wire types for machine-readable (JSON) output.
- `@prisma/cli-engine/testing` — the test harness for running commands in-process.

## Mounting commands

`createCli` takes commands by path. Every path with more than one word needs its group declared in `groups`, and the group's `brief` is its row on the parent's help card. A path can be a command and a group at once:

```ts
createCli({
  groups: { dev: { brief: "Run the app locally. Start it, print URLs, stop it" } },
  commands: { dev, "dev url": devUrl, "dev stop": devStop },
  // ...
});
```

`dev module.ts` runs `dev` with the positional `module.ts`, and `dev url gateway` runs `dev url`. When the word after `dev` names a command beneath it, that command runs, so `dev url` never reaches `dev` as a positional. To pass such a word as the positional, put `--` before it: `dev -- url` runs `dev` with `url`. A retired path declared as a redirect, such as `dev up`, wins over the positional the same way. `dev --help` shows the `dev` command's help and lists `url` and `stop`.

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

A statement is the command's own declared input, unlike a `--confirm` value, which a handler never sees. A command that needs some statements as input to its work, before it can know what to ask, takes them with `ctx.statements.take("rename")`: every unconsumed value of that verb, in argv order, as `{ verb, values, text }[]`. Taken values are consumed, and other verbs' values stay for the questions. A later question may still list a taken verb: no flag value of it is left to answer the question, so the verb serves the refusal's `--<verb>` form and what a user may type. `ctx.statements.values()` lists every unconsumed value of every verb in argv order without consuming any, for showing what a run was given, such as in a line that repeats the command. Take, and ask any consent with a token, before any `last: true` batch, which reports every value still unconsumed.

Each flag answers one question. A run that succeeds with a flag nothing consumed fails with `CLI.CONSENT_UNUSED`, so a mistyped subject or a second answer to one question is never ignored. The same holds for a `--confirm` token no consent asked for, on a command that declares statements (other commands still ignore a leftover `--confirm`; see [#339](https://github.com/prisma/prisma-cli/issues/339)). A refusal also names any given statement flag that matches none of its questions, and any `--confirm` token, so the user hears of it before answering a prompt. That check runs when the handler returns, after the command has acted. A command that asks everything in one batch passes `statements(questions, { last: true })` to get the same failure right after the questions are answered, before it does anything with them.

## Transforming a child's output

A command that declares `maySpawn` runs a child process with `ctx.spawn`. By default the child writes straight to the terminal, or, with `--json`, to stderr. To change the text before it is written, for example to redact secrets, pass `transformOutput`:

```ts
if (!ctx.spawnOptionNames?.includes("transformOutput")) {
  throw new Error("This command needs @prisma/cli-engine 0.10.0 or later.");
}
const result = await ctx.spawn({
  command: "alchemy",
  args: ["deploy"],
  transformOutput: (stream) => redactor(stream),
});
```

The engine calls `transformOutput` once for `"stdout"` and once for `"stderr"` before the child starts. It pipes each stream, decoded as UTF-8, through the `TransformStream` you return, and writes what comes out where the child's output would have gone without it:

- human and markdown format: the child's stdout to stdout, its stderr to stderr;
- json format: both to stderr, so stdout carries only the engine's NDJSON output.

Each stream keeps its own order; there is no order between the two. The engine reads the child only as fast as the terminal takes the text, so a slow reader slows the child down instead of filling memory. When a stream ends, the transform's `flush` runs and its output is written before `ctx.spawn` settles, including when the child was aborted or failed. A transform can therefore hold text back between chunks, as a redactor that matches across chunk boundaries must. Hold back only what could still become a secret, the longest end of the text that is a start of one, and not a fixed number of characters: a child that prints a prompt with no newline and waits for input must show the prompt at once. The engine never splits a UTF-16 surrogate pair across two writes, so a transform that cuts text by length does not corrupt an emoji.

When the command declares `needs: { credentials: "child" }`, the engine puts the access token in the child's `PRISMA_SERVICE_TOKEN`. The command never sees that value, so when the command passes `transformOutput`, the engine replaces the token with `[redacted]` itself, before your transform runs. Without `transformOutput` the engine does not read the child's output and does not redact the token, in any format, json included.

The engine still owns the child. Stdin stays inherited, Ctrl-C reaches the child as before, and a SIGTERM or an abort of `ctx.signal` ends it with SIGTERM, then SIGKILL after a grace period. If a transform throws or errors, or the destination fails, the engine stops reading that stream, ends the child the same way, and `ctx.spawn` rejects with that error once the child has exited. With `PRISMA_DEBUG=1`, a child output stream whose read fails, or that a grandchild keeps open with no output after the child exits, leaves a line saying its later output was dropped. A transform or destination failure leaves no such line, because `ctx.spawn` rejects with its error. A slow reader does not cause this: the grace period counts only time the engine spends waiting for output that does not come.

### Checking for support

Hosts older than 0.10.0 ignore spawn options they do not know, so on those hosts a child would run with its output untransformed. `ctx.spawnOptionNames` lists the option names `ctx.spawn` accepts; it is absent on those hosts, and its type is optional so the compiler makes you check it. Check it before spawning, as above. From 0.10.0 on, `ctx.spawn` refuses any option name it does not know, so a future option cannot be ignored silently.

### Spawn adapters

A spawn adapter supports `transformOutput` by starting the child with stdout and stderr piped when the request's `output` is `"engine"`, and returning both as `stdout` and `stderr` on the child. If the adapter returns no streams, the engine kills the child with SIGKILL at once and `ctx.spawn` rejects. An adapter written before `"engine"` existed has usually started that child with inherited output by then, so some of it can reach the terminal before the kill. This check catches a wrongly wired adapter; it does not make redaction safe with one.

Part of [prisma/prisma-cli](https://github.com/prisma/prisma-cli).
