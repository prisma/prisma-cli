# Does a use-case layer earn its place? The 31 ported commands

Scope: every command mounted in `packages/cli/src/v8/cli.ts` under `project` (11, including `project env`), `postgres` (11), `bucket` (6), `branch list`, and `git connect|disconnect`. Read from source. The prior maps in this directory were used as leads only; two of their calls are corrected at the end.

## Verdict

**No, not as a layer. Yes, for eight commands.**

Twenty-three of the 31 commands would produce a use-case file with exactly the shape bucket's produced: take an id, call one port method, reshape what comes back. The logic these commands genuinely share — resolving which project the command is about — is already shared, in one function in `lib/project/resolution.ts` that 21 of them call. A use-case layer would not consolidate it, because it is already consolidated. It would wrap it in 21 thin objects.

Eight commands do hold real logic, and it is not thinly spread. Six of them hold nearly all of it, and they fall into two families plus one outlier: **project setup and ownership** (`link`, `transfer`, `remove`, `create`), **environment variables** (`env add`, `env update`, `env list`, `env remove`), and `git connect`.

## The classification, and where I drew the lines

Four boxes, as instructed. Two calls needed judgement, so I state them up front.

**A check that a wire response is complete is transport, not domain.** `requireDatabaseProjectId` (`lib/database/provider.ts:634`), the missing-connection-string check in `normalizeRotatedConnection` (`:711`), and the `BUCKET_KEY_SECRET_MISSING` check (`adapters/bucket/management-provider.ts:183`) all say "the API sent me a record that is missing a field I need". That is the adapter validating its own input. It is box 3.

**Sorting a list for output is presentation, even when the sorted array reaches the JSON lane.** `sortDatabases`, `sortBranches`, `sortProjects` and the overview variable ordering all decide reading order. None of them changes what the command does or which records it returns. They are box 2.

## Per-command findings

`—` means no box-4 logic at all: the command parses arguments, resolves the shared project context, makes one or two API calls, and formats the answer.

### bucket (6) — the baseline

| Command | Box-4 content |
| --- | --- |
| `bucket list` | — |
| `bucket create` | — |
| `bucket delete` | — |
| `bucket key list` | — |
| `bucket key create` | 1 line: the default role is `read_write` |
| `bucket key delete` | — |

This confirms the premise. Note that only four of the six were put behind use cases; `bucket list` and `bucket create` call the provider directly from the handler and are no worse for it.

### postgres (11)

| Command | Box-4 content |
| --- | --- |
| `postgres list` | — (`sortDatabases` is ordering) |
| `postgres show` | — |
| `postgres create` | — |
| `postgres remove` | 1 line: the confirmation token is the *resolved* database id, so a user may name the database but must confirm the id |
| `postgres usage` | — (the `--from ≤ --to` check and the date-boundary expansion are argument validation) |
| `postgres backup list` | — (`--limit` bounds are argument validation) |
| `postgres restore` | 2 lines: the source database defaults to the target when `--source-database` is absent, and confirmation is against the *target* id |
| `postgres connection list` | — |
| `postgres connection create` | 1 line: the connection name defaults to a generated `cli-<timestamp>-<hex>` |
| `postgres connection remove` | — |
| `postgres connection rotate` | — |

Eleven commands, four lines. Every one of the eleven is "address one resource, call one method". Seven of them share one reference-resolution helper, `resolveDatabase` (`controllers/database.ts:912-953`, 42 lines): trim the reference, require it, list the project's databases, match on id or name, raise a distinct error for zero matches and for more than one, then fetch the full record for the single match. That is a real rule, but it is one rule shared by seven commands, and it already lives in one function.

### project (11)

| Command | Box-4 content |
| --- | --- |
| `project list` | Small. Classify the directory's pin as linked, invalid, or not-linked — "linked" requires both that the pin names the active workspace and that the pinned project is in the fetched list (`controllers/project.ts:106-141`, 36 lines). Its only consumer is the choice of next actions. |
| `project show` | — beyond the shared resolution rule, run in its "report, do not fail" mode |
| `project create` | Thin. Create the project, then bind the directory to it by writing `.prisma/local.json` and adding it to `.gitignore`. Two systems, one order, no branching (~3 lines at the call site). |
| `project link` | **Substantial, ~60 lines.** Two modes. With a reference: match it against the workspace's projects, then bind. Without one: offer a list plus "create new" plus "cancel"; cancel is an error; "create new" prompts for a name defaulted from the inferred project name, applies the same name rule the positional gets, creates, then binds. Duplicate project names are disambiguated by appending the id, but only for the names that actually collide. |
| `project rename` | — |
| `project remove` | Real, ~30 lines. After the remote removal, delete the local pin only if it points at the project that was removed; a failed delete becomes a warning on a successful run, never an error (`controllers/project.ts:1033-1061`). |
| `project transfer` | **Substantial, ~130 lines.** The recipient comes from exactly one of two flags — both is an error, neither is an error. A session authenticated by service token cannot use `--to-workspace` at all. The workspace path resolves a second, locally stored session and proves it works, mapping two distinct failures to two distinct errors. The order matters: confirm before touching the other workspace's session. Afterwards, rewrite the local pin to the recipient workspace when we know its id, clear it when we do not (the token path cannot know), do nothing when the pin names a different project, and downgrade any failure to a warning (`v8/project/transfer.ts:60-118, 203-258`; `controllers/project.ts:1063-1107`). |
| `project env add` | **Substantial, ~150 lines reachable.** A write must name its scope explicitly, so it can never silently hit production. A `--branch` scope creates the branch if it is missing — unless the project has no default branch yet, because the new branch would become the default and overrides are preview-only; and it is refused outright if the named branch is the production branch. The key must not already exist in the target scope. Adding a branch override for a key with no preview counterpart produces a warning. In file mode the precondition is all-or-nothing across the whole file, and a failure part-way through reports which keys were already written. |
| `project env update` | Real, ~40 lines plus the shared file-mode helpers. The key must exist. The branch must already exist — update never creates one. File mode is all-or-nothing on the same precondition, inverted. |
| `project env remove` | Real, ~25 lines. Same two rules: the key must exist, the branch must already exist. |
| `project env list` | **Substantial, ~110 lines.** Scope is resolved from three sources in precedence order: the explicit flag, then the local git branch, then nothing. Each source leads somewhere different — a local branch the platform does not know about reads preview-role variables but still suggests the branch flag; a local branch that *is* the production branch reads production; no local branch at all produces an overview across both roles. Then the variables shown for a branch are the effective set: the preview-role variables overlaid by that branch's overrides, keyed by name (`controllers/app-env.ts:611-697, 986-1009`). |

### branch list, git (3)

| Command | Box-4 content |
| --- | --- |
| `branch list` | — (production-first ordering and the `gitName` → `name` rename are presentation) |
| `git connect` | **Substantial, ~110 lines.** The repository URL comes from the argument or from the local `origin` remote; absent is an error and non-GitHub is a different error. If the project already has a connection, the same repository (compared case-insensitively) succeeds without doing anything, and a different one is refused. Otherwise, search the workspace's GitHub App installations, skipping suspended ones and skipping — without counting — any installation the API will not let us inspect. If the repository is not there, create an install intent, send the user to it, and poll until it appears. On timeout, choose between "installation required" and "repository not accessible" based on whether any installation could be inspected at all (`v8/git/connect.ts:52-121, 183-253`; `controllers/project.ts:1746-1786`; `v8/git/errors.ts:86-105`). |
| `git disconnect` | Small, 3 lines: refuse when the project has no connection. |

## The totals

| | Count |
| --- | --- |
| Would hold real content in a use case | **8** — `project link`, `project transfer`, `project remove`, `project env add`, `project env update`, `project env remove`, `project env list`, `git connect` |
| Thin: one check or one ordering constraint | **4** — `project create`, `project list`, `git disconnect`, `postgres restore` |
| Pass-throughs, exactly like bucket's | **19** — all 6 bucket, 10 of 11 postgres, `branch list`, `project show`, `project rename` |

Being generous to the layer, 12 of 31 have something. Being strict, 8. Either way, at least 19 of 31 — 61% — would be files whose whole body is a port call and a reshape.

File sizes corroborate this without being asked to. The six largest command files in `v8/` are `project/transfer.ts` (285), `git/connect.ts` (268), `project/env-add.ts` (227), `project/env-update.ts` (193), `project/env-shared.ts` (191) and `project/link.ts` (185). Those are five of the six commands named as substantial, plus the helper file serving the sixth. Every bucket file is between 44 and 110 lines, and every postgres command file is between 84 and 167.

## The shared logic: project resolution

It is reached by 24 of the 31, and it is **one rule, not many**. It already sits in one place.

- **The precedence walk** — `resolveProjectTarget` (`lib/project/resolution.ts:155-183`, with `resolveBoundProjectTarget:590-676` and `readImplicitLocalPin:678-716`; about 155 lines of decision). Explicit `--project` first, then `PRISMA_PROJECT_ID`, then the `.prisma/local.json` pin, then nothing. An explicit reference must match exactly one project by id or name, or you get a distinct not-found or ambiguous error. A pin whose workspace does not match the active one is a mismatch error; a pin whose project is gone is a stale error. Nothing at all is a setup-required error whose message and recovery commands depend on whether the caller supplied a command name, and which carries a suggested project name inferred from `package.json` or the directory basename. **Used by 20 commands** — all of postgres except `connection remove` and `connection rotate` (9), `bucket list` and `bucket create` (2), `project rename` and the four `project env` commands (5), `branch list` (1), both `git` commands (2), plus `project show` through the second entry point below.
- **The same walk in report mode** — `inspectProjectBinding` (`:185-221`). Identical, except that it refuses the environment-variable source and returns a "not linked" result instead of raising. **Used by 1 command**, `project show`.
- **A smaller sibling** — `resolveProjectForSetup` (`lib/project/setup.ts:42-57`, 16 lines). No walk: match a name or id against the fetched list, ambiguous or not-found otherwise. **Used by 3 commands** — `link`, `remove` and `transfer`, which must be able to name a project other than the pinned one.
- **A third variant that only reports** — `readProjectListLocalBinding`. **Used by 1 command**, `project list`.

Seven commands touch none of it: `bucket delete`, the three `bucket key` commands, `postgres connection remove`, `postgres connection rotate`, and `project create` (which writes the pin rather than reading it).

The conclusion this points at: **this is not per-command logic waiting to be pulled up into use cases. It is a library function that 21 commands already call.** Extracting it again would add a port boundary around the project catalog and the pin file — and that is port-and-adapter work, which the bucket trial already showed is worth doing. It is not use-case work.

## Where the logic concentrates

Sharply, not thinly. Six commands hold roughly 85% of all box-4 logic in the 31:

1. `project env add` — ~150 lines
2. `project transfer` — ~130 lines
3. `git connect` — ~110 lines
4. `project env list` — ~110 lines
5. `project link` — ~60 lines
6. `project env update` — ~40 lines

They are not scattered. Four of the six are two coherent families. **Environment variables** (`add`, `update`, `remove`, `list`) is one body of rules about scopes, branches and precedence, currently spread across `controllers/app-env.ts` (1,009 lines), `controllers/app-env-file.ts` (380) and `lib/app/env-config.ts` (196). **Project setup and ownership** (`create`, `link`, `remove`, `transfer`) is one body of rules about keeping the platform and the local `.prisma/local.json` pin consistent, currently spread between `controllers/project.ts` (2,309 lines) and the handlers themselves. `git connect` stands alone.

Two of these commands already carry their domain logic inline in the v8 handler: `resolveInstalledRepository` in `v8/git/connect.ts` (70 lines) and `resolveRecipient` plus `recipientSourceError` in `v8/project/transfer.ts` (58 lines). Those are the only two handlers in the 31 that do substantially more than parse, call and format.

## The rule that separates them

**Give a command a use case when it enforces a rule the platform API does not, or when it must keep two stores consistent. Otherwise the handler and a port are the whole command.**

Applied to these 31, that reads:

- **No use case** when the command's whole job is to address one resource by id or name and call one API method. The API owns every rule; there is nothing left over. This covers all of bucket, all of postgres, `branch list`, `project show` and `project rename`.
- **Use case** when the command owns an invariant the API will not check — a write must name its scope; a branch override cannot target the production branch; the first branch cannot be created from here; a key must, or must not, already exist; the whole file must be applicable before any of it is applied. This is the four `project env` commands.
- **Use case** when the command must keep the platform and a second store agreeing — the local pin, or another workspace's session. Something is created remotely and recorded locally, or moved remotely and re-pointed locally, and the two can disagree. This is `project create`, `link`, `remove` and `transfer`.
- **Use case** when the command coordinates a flow outside the API, with waiting and more than one way to fail. This is `git connect` alone.

A shorter test that gives the same answer on all 31: **if you can describe what the command does without using the word "unless", it does not need a use case.**

## Corrections to the prior maps

- `logic-map-resources.md` §8.4 calls the `BUCKET_KEY_SECRET_MISSING` check domain logic that should move from the adapter into a `createKey` use case. It should not move. The check asks whether the create-key response contained the secret it was supposed to contain. That is the adapter validating a wire response, and it belongs exactly where it is. The same applies to `requireDatabaseProjectId` and the rotate-response connection-string check in `lib/database/provider.ts`.
- `logic-map-resources.md` §8.5 calls the `gitName`-to-`name` mapping and the branch sort "business logic" belonging in a use case. Renaming a field for output and choosing a reading order are presentation. `branch list` has no domain logic.

## What this implies for the work

The port-and-adapter split earned its place and should continue across the remaining groups: it is what makes these commands testable without a network, and it is where the wire-shape checks correctly live.

The use-case layer should not be applied uniformly. Applied to bucket and postgres it produces 17 files that restate their port's signature. Applied to `project env` and to project setup and ownership it would collect two real bodies of rules that are currently spread across three large controller files, and give `git connect` somewhere to put the 70 lines now sitting in its handler.
