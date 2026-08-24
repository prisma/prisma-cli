# Prisma CLI Command Principles

## Purpose

This document defines the enduring rules for naming, grouping, and shaping commands across the Prisma CLI.

These rules apply to the current preview and to the future unified CLI.

## Core Rules

- Group commands by what developers do, not by product ownership.
- Canonical shape is `prisma <group> <action>`.
- Do not introduce `orm`, `postgres`, or `compute` namespaces.
- Prefer one obvious happy path in the MVP.
- Make defaults smart, but never surprising.

## Related Docs

Use this doc for command language and behavior.

Use the other convention docs for adjacent concerns:

- `cli-style-guide.md`: help, flags, interactivity, symbols, and TTY behavior
- `output-conventions.md`: stdout, stderr, and JSON behavior
- `error-conventions.md`: error taxonomy and envelopes

## Stable Groups

The long-term command surface grows through workflow groups such as:

- `skills`
- `auth`
- `project`
- `branch`
- `schema`
- `database`
- `db`
- `app`
- `git`

The preview implements only `auth`, `project`, `git`, `branch`, `database`, `bucket`, `app`, `skills`, and `init`.

## Stable Nouns

The CLI should keep the meaning of these nouns stable:

- `workspace`
- `project`
- `branch`
- `schema`
- `database`
- `bucket`
- `service`
- `version` (always qualified in prose: a service version)
- `domain`

If a noun means one thing in docs and a different thing in commands or output, the model is already drifting.

## Stable Verbs

Each verb should have one clear meaning.

### `show`

Display one resource or one current context.

Examples:

- `project show`
- `app show-deploy`

### `list`

Display a collection of resources.

Examples:

- `project list`
- `branch list`
- `app list-deploys`

### `use`

Change local CLI context only.

`use` must never mutate a remote resource.

`use` changes local active context only.

No current branch command uses `use`; branch targeting follows explicit flags or source context.

### `deploy`

Build and release an app into a target branch.

### `init`

Prepare the current repository for Prisma development, entirely locally: add the `postinstall` script that keeps the Prisma agent skills in sync (`prisma skills sync || exit 0`), scaffold a `prisma.config.ts` recording which agents get skills, then sync the skills once now.

The scaffolded config imports `definePrismaConfig` from `prisma/config` and spells out `skills: { agents: [...] }`. The agents come from the `--skills` flag (`--skills=claude,cursor`, validated against the known agent names), or the default set when the flag is absent. `--skills=none` records the choice rather than merely skipping: the scaffold is written with `skills: { agents: [] }` — the committed record that no agent skills are wanted — and the sync is skipped on that run; with `agents: []` in place, later syncs, `skills list`, and the staleness notice all treat the project as having no skills to manage. There is no harness detection: the config is the only authority on which agents a project uses.

`init` calls no platform API, never prompts, and never edits a file the user already owns: a `postinstall` script the user wrote and an existing `prisma.config.ts` are both left alone and reported as diagnostics — the config diagnostic shows the exact `skills: { agents: [...] }` snippet to add by hand. Everything lands in the current directory: the hook in its `package.json`, the config beside it, the skill copies in the agent directories under it. Rerunning is safe; each step reports what is already done and the command exits 0.

### `logs`

Resolve a service version and show or stream its logs.

### `delete` and `remove`

`delete` destroys a resource; `remove` detaches one thing from another without destroying it. A command that permanently destroys what it targets is spelled `delete` (`project delete`, `service delete`, `postgres delete`); `remove` is reserved for detachment.

### Subjects are positional

A command that operates on a subject resource takes that resource's identifier as its first positional argument (`service show my-api`, `postgres delete db_123`, `service version promote cpv_123`) — the established convention across CLIs. Flags never name the subject; they scope or qualify it (`--project`, `--branch`, `--role`). The argument primarily targets the stable platform id, with the display name as a secondary fallback: an id match always wins, and a resource named like another resource's id can never shadow it. Environment variables never target a subject. When the subject's identifier is globally unique — a service version id, a bucket id — the id alone is the complete target, and the command asks for no redundant parent scope.

### `wait`

Block until a remote resource reaches a terminal state.

Example:

- `app domain wait`

### `promote`

Take a validated source and release it into a more trusted branch.

In the MVP, that means preview source plus production rebuild.

### `rollback`

Return traffic to a previous healthy service version without rebuilding.

In the MVP, that means production rollback only.

## Compound Actions

The canonical grammar stays `prisma <group> <action>`.

When a group acts on a subordinate resource, the action may be a compound verb phrase such as:

- `app list-deploys`
- `app show-deploy`

That is still one action in the command grammar. It is preferable to inventing a temporary top-level `deployment` group for the MVP.

## Shared Flag Conventions

Shared CLI flag rules:

- long flags use kebab-case
- boolean negation uses `--no-<flag>`
- short aliases exist only for high-frequency flags
- flag meaning should stay stable across commands

Convenience aliases may exist later, but they are not canonical design.

That applies to command groups too:

- do not replace canonical long-form groups with product- or slice-specific shorthand
- for example, `database` may later gain a short alias, but `db` must not replace `database` as the canonical group name

## Context Must Be Predictable

Commands that act on a target must resolve that target predictably.

MVP rule:

1. explicit command targeting wins
2. local active context is next
3. safe command defaults come last

Commands may act on remote state, but they must not silently mutate local context.

## Production Must Be Intentionally Harder

Production is never the accidental path.

The CLI should make production feel deliberate by:

- defaulting first remote deploy to preview
- warning when production becomes active context
- preferring `app promote` as the normal release path
- keeping rollback fast and production-focused

Direct production deploys may exist, but only through explicit targeting.

## Progressive Disclosure

The common path should stay short.

Users should not need to learn:

- project lifecycle details
- app creation mechanics
- branch orchestration details
- platform internals

before their first successful deploy.

The CLI may use those concepts internally, but it should surface them only when they matter.

## Human and Agent Use

The CLI must work well for both humans and agents.

That means:

- default output is concise, human-readable, and calm
- structured output is explicit enough for agents to make safe choices
- human output and JSON output describe the same truth, but may render it differently
- targeting rules are deterministic
- risky actions are surfaced clearly
- nouns and verbs stay stable across help, docs, and output
- shared UX rules stay centralized rather than reinvented per command group
- local metadata may suggest defaults, but must not be presented as target selection
- missing context ends with clear next actions, not implicit resolution

## No Dead Ends

Commands should not stop at status.

They should also make the next useful step obvious, especially after:

- successful deploy
- failed deploy
- missing context
- blocked production action

## Anti-Patterns

Avoid:

- product-branded silos like `prisma compute deploy`
- temporary grammar for the MVP
- hidden targeting
- verb overload
- several equal paths with no canonical default

## Evaluation Check

Before adding a command, ask:

1. Is it grouped by workflow?
2. Does it preserve the long-term resource model?
3. Are its noun and verb already stable elsewhere in the CLI?
4. Is its target resolution predictable?
5. Is it safe around production?
6. Is there a clearer single happy path?
