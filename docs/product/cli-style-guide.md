# Prisma CLI Style Guide

## Purpose

This document defines the cross-cutting UX rules for the Prisma CLI.

Use it for:

- tone and presentation
- help and examples
- flags and interactivity
- loading indicators
- TTY and color behavior

Use the other docs for the rest of the model:

- `command-principles.md`: command grammar and naming
- `output-conventions.md`: stdout, stderr, and structured output
- `error-conventions.md`: error taxonomy and envelopes

## Core Style

- Friendly, polished, and concise.
- Symbols are fine; emojis are not.
- Minimal ceremony by default.
- The CLI should help the user move forward, not admire the interface.
- Default to beautiful for humans and explicit structure for agents.
- Human output should feel calm and deliberate rather than loud.

Recommended symbols:

- success: `✔`
- error: `✘`
- warning: `⚠`
- pending: `◇`
- info: `ℹ`
- step: `›`
- arrow: `→`
- tree: `│`, `├─`, `└─`

## Color

- Use color to reinforce meaning, not to carry meaning alone.
- Recommended mapping:
  - success: green
  - error: red
  - warning: yellow
  - info: blue
  - accent: cyan or teal
  - secondary text: dim
- Use bright white only for primary values that need emphasis.
- Links should use the info color rather than the error, success, or accent colors.
- Respect `NO_COLOR`.
- Auto-disable color and animation in non-TTY contexts.
- `--color` and `--no-color` override auto-detection.

## Human Presentation

- Human-facing paths should usually be shown relative to the current working directory.
- Structured output should use the literal machine-meaningful value.
- Banners are reserved for first-run experiences such as `auth login`.
- Outside those flows, focus on status, context, result, and next steps.

Human-oriented command output in TTY mode should usually start with a compact header.

Bound state:

```text
project show → This directory is linked to the following platform project.

│  local repo  ~/code/apple
│  platform    Edith / orange
│
│  → https://prisma.build/edith/orange
```

Recovery state:

```text
project show → This directory is not linked to a Prisma Project.

│  workspace:  Acme Inc
│  project:    Not linked

Next steps:
- Link an existing Project you choose: prisma project link <id-or-name>
- Create a new Project: prisma project create billing-api
```

Rules:

- use `→` between the command name and one-line description
- render the left rail with dim `│`
- align keys in a compact column
- use accent color for keys and default text for values
- prefer display labels in default human output and keep opaque ids in JSON unless a later verbose mode explicitly asks for them
- print values bare; a secret the command exists to hand over is never masked, because the human card is where its owner reads it (operator ruling, 2026-08-26)
- include only rows that are actually known for the current command
- use human labels such as `Not linked` instead of internal resolution terms such as `unbound`
- hide internal resolution terms such as `local pin` from default human output when the visible binding is clearer
- document distinct success and recovery states when a command's terminal output materially differs
- include a `Read more` row that points to the source-of-truth repo doc or anchor until a stable public docs URL exists
- leave one blank line between the header block and the body

Tree or hierarchical output should use dim connectors and colored status symbols:

```text
✘ contract
├─ ✘ table user
│  └─ ✔ primary key: id
```

Rules:

- connectors stay dim and should guide the eye without competing with the content
- status symbols come before the label
- supplementary detail may use dim text in parentheses
- indent nested tree content consistently

## Help and Usage

The wording contract for help text, and the reasoning behind it, is
`cli-help-standard.md`. This section covers the card structure and
formatting.

Help should feel like the rest of the CLI:

- concise
- readable
- copy-pastable
- explicit about defaults

Help output should:

- describe what the command does
- show the most important options
- include 1-2 copy-pastable examples
- show aliases and defaults inline when relevant
- use the same command nouns as the rest of the docs
- use the same card framing as command headers
- align flag descriptions into a stable description column
- show placeholder values such as `<path>` in dim text
- keep examples indented and copy-pastable

Unknown commands should show "Did you mean ..." suggestions when there is a clear close match.

### Descriptions Describe Intent

Help text is read by people and by agents that have never seen the platform's resource model. Help is a manual, not a summary. Write for both:

- The summary states what the command does. When the command name already says it, the summary stays a plain restatement (`project list` → "List the projects in your workspace") and no description is added.
- A description earns its place by adding intent: when to run the command, what it operates on, and what happens next. It must not paraphrase the command name.
- A group's brief is a short lead sentence, then the scope of what lives beneath it ("Manage S3-compatible object-store buckets for a project. CRUD operations and access keys"). "CRUD" may stand in for the common verbs; operations a reader would not guess (link, transfer, promote) are named.
- A group's description defines every term its command rows rely on. If a row says "linked", the group card says what linking is before the reader opens the leaf.
- Do not assume the reader knows Prisma nouns. The first time a group or command depends on one, define it in one clause: a Project groups one product or codebase inside a workspace; a Branch maps to a Git branch and is an isolated environment with its own services, databases, and buckets.
- Internal resolution terms stay out of help: no "binding", "resolved", "pinned", or "active" without a plain-language definition in the same card. Prefer the plain phrase outright ("the project this directory is linked to" over "the resolved project").
- Refer to Prisma ORM by that name. Do not use retired product names such as "Prisma Next" in help text.

### Flag Briefs Say When

A flag brief states what the flag does; when the flag exists for a distinct situation, it also says when to reach for it ("--branch: target a preview branch instead of the default branch"). Defaults render as an automatic suffix, so briefs do not repeat them.

### Workflow Sections

A group card may declare a workflow: the ordered commands of that group's common path, each with a short purpose column. The engine renders it as a `Workflow` section, before any examples, with each step `$`-prefixed and copy-pastable. Declare a workflow only where a real multi-command path exists; a group of independent commands has no workflow.

## Flags

Shared flag rules:

- long flags use kebab-case
- boolean negation uses `--no-<flag>`
- short aliases exist only for high-frequency flags
- flags should mean the same thing across commands whenever possible

Shared global flags, defined by the engine in `SHARED_FLAG_PARAMETERS` (`packages/cli-engine/src/execution/shared-flags.ts`, the source of truth for this list):

- `--format <human|json>`
- `--json` (shorthand for `--format json`)
- `--log-level <error|warn|info|verbose>`
- `-v`, `--verbose` (shorthand for `--log-level verbose`)
- `-q`, `--quiet` (shorthand for `--log-level error`)
- `-y`, `--yes` (accept prompt defaults)
- `--confirm <value>` (grant a consent prompt non-interactively; repeatable)
- `--interactive`, `--no-interactive`
- `--color`, `--no-color`
- `--config <path>`

`--log-level` and its `--verbose`/`--quiet` shorthands affect human commentary detail, not the JSON schema.

## Interactivity

- Interactivity defaults from TTY context unless a command intentionally behaves otherwise.
- `--interactive` and `--no-interactive` override the default.
- `-y` and `--yes` accept confirmation prompts.
- Non-TTY, CI, and `--json` mode should never block on a prompt.

Prompt rules:

- selection prompts should use arrow-key navigation rather than numbered menus
- the prompt question should begin with `?`
- the selected option should be visibly highlighted with an accent marker such as `❯`
- completed prompts should collapse to a single confirmed line when possible
- text input should mask sensitive values in the echoed confirmation line
- `Esc` should cancel interactive prompts when the prompt library supports it

When a command needs confirmation and cannot prompt:

- fail with a structured actionable error
- explain what needs confirmation
- suggest `-y` when it is a valid bypass

## Loading Indicators

Loading indicators are for slow or remote work, not for every step.

- Use spinners or progress indicators only when the wait is noticeable.
- Suppress them in non-TTY mode, quiet mode, and JSON mode.
- Avoid flicker for fast operations.
- Nested work should usually be rendered as step lines, not stacked spinners.
- Prefer one visible spinner at a time.
- Use a calm pending symbol such as `◇` or a smooth Unicode spinner frame.

## Non-TTY Behavior

Non-TTY behavior should be automation-friendly:

- no prompts unless explicitly supported and satisfied
- no decorative output noise
- no dependence on color, cursor control, or animation
- machine-readable output stays stable
- decorative header framing and spinners should be suppressed
- stderr should stay concise enough for captures, CI logs, and agent inspection

## Accessibility and Safety

- Do not rely on color alone.
- Keep text compact and translatable.
- Never leak secrets into logs, errors, telemetry, or previews. A secret the command exists to hand over prints bare, once.

## Design Rule

The CLI should feel consistent across products and command groups.

If a style choice works only for one product slice, it is probably the wrong default for the unified Prisma CLI.
