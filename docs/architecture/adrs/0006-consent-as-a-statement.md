# ADR 0006 - A consent can be a statement the command declares and the user answers with

## Status

Accepted (operator, 2026-10-07).

## Context

The engine's consent prompt asks the user to type a fixed token, or to pass it as `--confirm <token>`. That fits an operation with one thing at stake and one way to agree: delete this project, restore over this database. It does not fit a command that finds several risky operations in one run and needs to know, for each one, what the user *means*. The ORM's migration planner is the first such command: a dropped table may be a rename or a deletion, and only the user can say which. A yes/no answer, or a copied token, cannot carry that meaning, and one `--confirm` cannot answer several questions in a way a reader of the script can check.

The constraints the existing consent set still hold: nothing may be inferred, `--yes` must never grant it, a script or an agent must be able to answer up front, and a human in a terminal must be asked.

## Decision

A command declares the statements it may ask for, with the number of values each takes:

```ts
defineCommand({
  statements: { rename: { arity: 1, brief: "..." }, delete: { arity: 1, brief: "..." } },
  ...
})
```

The engine knows no verbs. For that command only, it parses `--<verb>` followed by `arity` values, repeatable, before the rest of argv reaches the argument parser, keeps the values in argv order, and keeps them out of the handler's flags. No other command accepts the flag, and a verb may not share a name with any flag of the command or of the engine.

The command asks with `ctx.prompt.statement(question, { subject, verbs, validate })`, or several questions at once with `ctx.prompt.statements([...], { last })`. Each question names a subject in the command's own vocabulary and the verbs that may answer it, and `validate` decides whether an answer is acceptable. The engine interprets one thing in a value: whether it names the subject, which it does when it equals the subject or starts with the subject followed by `:`. The separator is `:` because that is the subject grammar of the first consumer, the ORM, whose renames read `Old:New`; a product whose values use another separator picks subjects that no value can name by accident. Beyond that, the engine never interprets the answer's text. A question is answered in this order:

1. From the command line, by a value of one of its verbs that names the subject. A value `validate` rejects fails the run with `CLI.PROMPT_INVALID`, since a wrong flag cannot be corrected by asking again.
2. Outside an interactive terminal, or under `--yes`, by nobody: the run fails with one `CLI.CONSENT_REQUIRED` that lists every unanswered question with the flag that would answer it.
3. Interactively, by the user typing `<verb> <value>` (or `<verb>` alone for the subject itself), validated the same way and asked again when rejected.

A statement is the command's own declared input, unlike a `--confirm` value, which a handler never sees: a command whose work depends on some statements, as the ORM plans with its renames before it knows what still loses data, takes a verb's values in argv order with `ctx.statements.take(verb)`, which consumes them.

A value nothing asked about or took is an error, `CLI.CONSENT_UNUSED`, at the end of a run that otherwise succeeded, or at once when the command marks its final batch with `last: true`. A statement is a consent: it has no default and `--yes` never answers it.

`consent(question, { token })` and `--confirm` stay for commands with one thing at stake.

### Rules added after acceptance

These came from the ORM's first use and the reviews of this change, all in engine 0.7.0:

- **`ctx.statements.take(verb)`** returns a verb's values in argv order and consumes them, for statements that are input to the command's work. A question may still list a taken verb; no value of it is left to answer the question, so the verb serves the refusal's flag form and the typed answer. Take before any `last: true` batch.
- **`ctx.statements.values()`** lists every unconsumed value in argv order without consuming any, so a command can show what it was given without spending it.
- **Longest subject first.** Within one `statements` batch, a value equal to a subject answers that subject first, and any other value goes to the question with the longest subject it names. So `A:B` answers the question about `A:B`, not the one about `A`. Questions whose subjects are prefixes of one another belong in one batch, because separate calls cannot be resolved this way.
- **`:` in a subject is allowed**, with the matching rule unchanged.
- **`last: true`** marks a batch as the run's final ask: values still unconsumed fail with `CLI.CONSENT_UNUSED` as soon as it is answered, before the command acts on the answers.

## Consequences

- A product adds a consent vocabulary by declaring it on the command that uses it, and its help text with it. The engine stays free of product words.
- The interactive form and the scripted form share one validation (`validate`) and one refusal text, which names the flag. They differ in how a value is matched to a question: a flag value must name the subject, while a typed answer is given to the question being asked.
- Statement flags are removed from argv before the argument parser sees it, because that parser gives a flag one value per occurrence and a statement may take more. The engine routes the leading words to the command itself to know which verbs apply; that routing is tested against the parser's own.
- A typed answer or a flag value is validated by the command, so an unknown subject is the command's error, with the command's message.
- This is a minor engine release (0.7.0): a new prompt surface member, new error codes, and a new optional field on `defineCommand`. Commands built against 0.6 load unchanged.
