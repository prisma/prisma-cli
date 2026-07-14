# Prisma CLI Output Conventions

## Purpose

This document defines how commands use stdout and stderr, and how they report success, progress, warnings, and structured data.

Use `cli-style-guide.md` for broader presentation rules. This document is the source of truth for stream behavior and structured output.

## Stream Model

The CLI follows one stream model:

- `stdout` is for machine-readable data only
- `stderr` is for human-oriented decoration and status

Human-oriented stderr output may include:

- command headers
- progress
- warnings
- automatic update notifications
- help text
- target context
- final human-readable success or failure summaries

Rules:

- never write machine-readable data to stderr
- never write decorative or human-only output to stdout
- when `--json` is active, stdout must contain only structured output

## TTY and Piped Behavior

Interactive TTY behavior:

- human-oriented status and progress are visible on stderr
- stdout is used only when the command emits data
- header framing, alignment, and color may be used when they improve scanability

Non-TTY or piped behavior:

- decorative output is suppressed
- prompts are not shown
- machine-readable output remains stable
- headers collapse to plain text or are omitted when they add no value

This keeps pipes, captures, and automation clean.

## Automatic Update Notifications

The CLI may print an advisory update notification before normal command output
when all of these are true:

- stderr is a TTY
- `--json` is not active
- `--quiet` is not active
- CI is not detected
- `NO_UPDATE_NOTIFIER` is not set
- cached update-check state already shows a newer official `@prisma/cli`
  version

The notification is human-only stderr output. It must never be written to
stdout, must not change the original command exit code, and must not block the
original command on network discovery.

Recommended shape:

```text
Update available: prisma-cli <current> -> <latest>
Run <package-manager command> to update.
```

When the CLI cannot confidently infer the install context, link to installation
docs instead of guessing a package-manager command:

```text
Update available: prisma-cli <current> -> <latest>
See https://www.prisma.io/docs/orm/tools/prisma-cli for update instructions.
```

## Human Output

Human-facing output should follow `cli-style-guide.md` and optimize for:

- clarity
- scanability
- obvious target context
- obvious next step

Human output patterns are shared across commands. If two commands perform the same kind of action, they must use the same structural pattern and differ only in nouns, values, and documented annotations.

### Pattern Mapping

Current MVP commands map to patterns like this:

| Command | Pattern |
| --- | --- |
| `version` | `show` |
| `feedback` | `show` (send confirmation card) |
| `auth login` | `mutate` |
| `auth logout` | `mutate` |
| `auth whoami` | `show` |
| `auth workspace list` | `list` |
| `auth workspace use` | `mutate` |
| `auth workspace logout` | `mutate` |
| `project list` | `list` |
| `project show` | `show` |
| `git connect` | `mutate` |
| `git disconnect` | `mutate` |
| `branch list` | `list` |
| `database list` | `list` |
| `database show` | `show` |
| `database create` | compact mutate stderr + raw secret stdout + JSON envelope |
| `database remove` | `mutate` |
| `database connection list` | `list` |
| `database connection create` | compact mutate stderr + raw secret stdout + JSON envelope |
| `database connection remove` | `mutate` |

No current MVP command uses `verify` or `inspect`, but new commands must still choose one existing pattern rather than inventing a new one casually.

### One-Time Secret Output

Commands that create one-time-view secrets may write the raw secret value to
stdout in human mode. This is still machine-readable output, not decorative
human output.

Rules:

- write exactly one raw secret value per successful create command
- write human creation summaries to stderr before writing the raw secret to stdout
- do not repeat the secret on stderr
- do not wrap the secret in labels such as `DATABASE_URL=`
- use `--verbose` for human metadata such as resource ids; keep generated names and opaque ids out of default human output unless they are the user-selected target
- `--quiet` suppresses successful human stderr output and still writes the raw secret to stdout
- list and show commands must never print or return secret values
- in `--json`, include the secret exactly once in the result object

### Shared Patterns

#### `list`

Use for commands that retrieve and display a collection of items.

Structure:

```text
<command> → Listing <object-plural> for the <parent scope>.

│  <parent-key>:   <parent-value>
│  ⚬ <item-noun>:  <item-label> (<annotation>)
│  ⚬ <item-noun>:  <item-label>
│
│  Read more       <docs-link>
```

Rules:

- the title uses a present participle such as `Listing`
- the first row in the card is the parent scope
- each list row uses `⚬` and repeats the same item noun
- `project list` may render a compact name/id table instead of bullet rows because project errors and recovery commands use ids as stable handles
- annotations are limited to one per row and use:
  - `(active)` for current context
  - `(default)` when the command defines a default item
- human output prefers display labels over opaque ids
- empty lists render a single dim sentence in the item area such as `No projects found.`

In `--json`, all list commands use this result shape:

```json
{
  "context": {
    "<parent-key>": "<parent-value>"
  },
  "items": [
    {
      "name": "<label>",
      "id": "<identifier>",
      "status": "active"
    }
  ],
  "count": 1
}
```

`status` may be `"active"`, `"default"`, or `null`.

#### `show`

Use for commands that display one resource or one current context.

Structure:

```text
<command> → <description>.

│  <key>:    <value>
│  <key>:    <value>
│
│  Read more  <docs-link>
```

Rules:

- use a flat aligned key-value card with no bullets
- keys use the accent color and values use the default foreground unless status coloring applies
- sensitive values are masked rather than omitted
- human output prefers display labels, URLs, and statuses over opaque ids

#### `mutate`

Use for commands that change local or remote state.

Structure:

```text
<command> → <description>.

│  <context-key>:  <context-value>
│  <context-key>:  <context-value>
│
│  Read more       <docs-link>

◇ <operation description>...
✔ Applied <N> operation(s)
  <detail line>
```

Rules:

- the header card shows execution context
- the body uses `◇` while describing the operation and `✔` or `✘` for the final summary
- detail lines are indented two spaces below the summary
- warnings may follow the operation block when they materially affect the next user action

#### `verify`

Use for commands that validate state without changing it.

#### `inspect`

Use for commands that read and display external system state without validation side effects.

### Recommended Shape

For most human-facing commands in TTY mode:

1. compact command header
2. one blank line
3. body content such as fields, rows, trees, or progress
4. next useful commands when relevant

For mutating commands:

1. short progress lines for long-running work
2. final success or failure block
3. key resource context
4. next useful commands

For list commands:

- use scan-friendly rows
- keep ordering stable
- show the fields a user needs to act next

For show commands:

- use a compact field/value block
- identify the resource clearly

Human output should:

- use symbols rather than emojis
- prefer relative paths when a path is explanatory text
- keep ceremony low
- reserve banners for `init` and similar first-run flows
- keep header metadata compact and aligned
- avoid placeholder rows for unknown values

Recommended header shape for a bound Project:

```text
project show → This directory is linked to the following platform project.

│  local repo  ~/code/apple
│  platform    Edith / orange
│
│  → https://prisma.build/edith/orange
```

Recommended recovery shape for an unbound Project:

```text
project show → This directory is not linked to a Prisma Project.

│  workspace:  Acme Inc
│  project:    Not linked

Next steps:
- Link an existing Project you choose: prisma-cli project link <id-or-name>
- Create a new Project: prisma-cli project create billing-api
```

Rules:

- use a dim left rail such as `│`
- use accent color for keys and default text for values
- show only metadata that is relevant to the current invocation
- include `Read more` when a stable repo doc reference exists
- prefer display labels in default human output and keep opaque ids in JSON unless a later verbose mode explicitly asks for them
- do not expose agent-only reasoning in human output when a clear status and next step is enough
- for bound `project show`, show the local repo, platform project label, and Project URL instead of the internal resolution source
- keep explicit recovery examples when a command has a distinct not-linked or setup-required state

Recommended summary lines:

```text
✔ Project resolved
✘ Authentication required [AUTH_REQUIRED]
```

Rules:

- success and failure summaries should be easy to spot
- stable error codes should remain visible on human failures
- next steps may appear after the summary block when they materially help recovery or continuation

Recommended tree shape for nested or hierarchical output:

```text
✘ contract
├─ ✘ table user
│  └─ ✔ primary key: id
```

## Target Context Must Be Visible

When a command acts on a project, branch, app, or deployment, the output should make that resolved target visible.

Examples:

- `app deploy` should state the resolved target that matters in the current slice
- first local `app deploy` binding should make the Project choice explicit before work begins
- subsequent `app deploy` calls should use a compact target header such as `Deploying ./j1 to j1 / main / j1`
- config-backed `app deploy` builds should show the resolved build settings before build starts: `Build Command` and `Output Directory` with their sources (`prisma.compute.ts` or inference), `Output Directory` as a literal path such as `.next/standalone` rather than an opaque framework default label
- `app logs` should state the deployment it resolved
- `app list-deploys` should state which app or branch is being listed

The CLI must not make users guess which target a command acted on.

For `app deploy`, Project setup is a one-time local binding surface, not a
per-run summary. If no Project is resolved in interactive mode, ask which
Project the directory should use with an arrow-key selection prompt. The picker
lists existing Projects, then `Create a new Project`, then `Cancel`; do not add
a manual id/name entry to the picker. If the user chooses to create a Project,
prompt for a Project name using the package/directory name as an editable
suggestion. Once `.prisma/local.json` has been written, retries and later
deploys should feel like deploys, not setup.

After setup, keep the confirmation compact:

```text
✔ Linked "./my-app" to Project "Acme Dashboard"
Saved .prisma/local.json

Deploying to Acme Dashboard / feat-login / my-app

Detected Next.js
│  framework:  Next.js
│  runtime:    HTTP 3000

? Customize build settings? No
```

Deploy progress should describe phases without claiming runtime success before
health is known. Do not print `Status: running` or `Deployment is running at ...`.
Use short stage copy such as `Building locally...`, `Built <size>`,
`Uploading...`, `Uploaded`, `Deploying...`, and `Deployed`.
On success, print `Live in <duration>`, the URL on its own line, and
`Logs   prisma-cli app logs`.
Human deploy output is stderr; `--json` is the machine-readable stdout path.

Deploy result rows use one compact style: labels start two spaces from the left
margin and values align in one column. Avoid repeating a full Workspace /
Project / Branch / App / Framework / Runtime table in the setup path unless a
future command needs that extra detail.

## Action and Data Commands

Action commands and data commands follow the same stream rules, but not every command needs the same stdout behavior.

- action commands may produce no stdout payload unless `--json` is requested
- data commands may emit structured stdout payloads
- in human TTY mode, both kinds may still show status and next steps on stderr

For automation, commands should prefer explicit `--json` rather than relying on human stderr output.

`--quiet` suppresses successful human output, but it does not change JSON mode and should not hide actionable failures.

## `--json`

Every MVP command supports `--json`.

Rules:

- JSON mode is explicit
- stdout must contain only JSON
- no human prose may be mixed into stdout in JSON mode
- human-oriented decoration should be suppressed in JSON mode
- missing values should be `null`, not placeholder strings

## Non-Streaming JSON Shape

Commands that return one final result should emit one JSON object to stdout.

Recommended envelope:

```json
{
  "ok": true,
  "command": "app.deploy",
  "result": {},
  "warnings": [],
  "nextSteps": [],
  "nextActions": []
}
```

Required conventions:

- `ok` is `true` on success and `false` on failure
- `command` is a stable command identifier
- `result` holds command-specific data
- `warnings` is always present
- `nextSteps` is always present, even if empty
- `nextActions` is always present, even if empty
- human-readable guidance that matters to automation should also be represented in structured fields, not only on stderr

`nextSteps` remains a compatibility surface for readable commands. `nextActions`
is the structured surface for agents and automation:

```ts
type NextAction = {
  kind: "run-command" | "user-choice" | "edit-file" | "done"
  journey: "project-setup" | "deploy-app" | "inspect" | "recover"
  label: string
  command?: string
  commands?: string[]
  reason?: string
}
```

Use `user-choice` when the next move requires the caller or user to choose a
target. Do not encode local package names, directory names, or nearby matches as
a selected target; put them in command-specific suggestion fields instead.

## Streaming JSON Shape

True streaming commands should emit newline-delimited JSON events in `--json` mode.

This applies to:

- `app deploy`
- `app logs`

Recommended event shape:

```json
{
  "type": "progress",
  "command": "app.deploy",
  "timestamp": "2026-04-08T12:00:00Z",
  "data": {}
}
```

Required conventions:

- one JSON object per line
- `type` is stable and explicit
- `timestamp` is ISO 8601 UTC
- the final event is either success or error
- non-streaming commands should continue to use a single JSON object rather than NDJSON

In human mode, `app logs` is a special case: raw app log lines are the primary
streamed payload and go to stdout so they can be piped or redirected. CLI
context, status, decoration, and errors stay on stderr.

## Data Conventions

- ids are opaque and stable
- URLs are absolute
- timestamps are ISO 8601 UTC
- branch names are returned exactly as resolved when the command resolves a branch
- app names are returned exactly as resolved when the command resolves an app
- list results are newest first unless the command says otherwise

## Example Success Payload

```json
{
  "ok": true,
  "command": "app.deploy",
  "result": {
    "projectId": "proj_123",
    "app": {
      "id": "app_123",
      "name": "hello-world"
    },
    "deployment": {
      "id": "dep_045",
      "status": "ready",
      "url": "https://hello-world.prisma.app"
    }
  },
  "warnings": [],
  "nextSteps": [
    "prisma-cli app list-deploys --app hello-world",
    "prisma-cli app show-deploy dep_045"
  ],
  "nextActions": [
    {
      "kind": "run-command",
      "journey": "inspect",
      "label": "View deployment logs",
      "command": "prisma-cli app logs"
    }
  ]
}
```

## Design Rule

Human output and JSON output should describe the same underlying model.

The CLI should never require users or agents to learn different meanings for the same command.

Human output should stay optimized for people. JSON should carry the same model
with enough explicit structure for agents to recognize stop points, user-choice
moments, and safe recovery actions.
