# Requirements for the unified CLI engine

Status: **Agreed** (Will Madden, 2026-08-09), including the engine-internals
decision at the end. This document records the design constraints for the
consolidated `prisma` CLI — the interface between the CLI shell and the
product packages it hosts (Prisma ORM, Prisma Composer, Prisma Cloud) — and
why each constraint matters. It precedes and will govern the engine's design;
tool and framework choices are evaluated against this list, not the other way
around.

## The shape being constrained

One `prisma` binary. It owns everything user-facing — argument parsing, help,
prompts, rendering, `--json`, exit codes, loading `prisma.config.ts` — and it
gets its functionality from product packages it depends on. Each product
already exposes a typed operations API returning structured results; the
engine is the thin layer that turns argv into operation calls. These
requirements constrain that layer and the package interface around it.

## Requirements

### R1 — One language, directly executable

A product authors its CLI contributions in the engine's vocabulary, and that
artifact is what runs. There is no product-side data structure that a separate
interpreter translates into commands.

**Why:** every stage of interpretation is complexity we own forever — a schema
that grows toward being a CLI framework, an interpreter to maintain, and a
translation step contributors must understand before they can add a flag.
Complexity raises the odds something goes wrong, deters outside contributions,
and makes testing indirect. One vocabulary that is itself runnable keeps the
system learnable and the test path short.

### R2 — Commands end in typed operation calls

A command handler calls its product's operations client, and TypeScript
enforces the arguments. The command layer contains phrasing and wiring, never
business logic.

**Why:** the operations layer is where correctness is enforced and where
exhaustive testing lives. If command handlers grow logic, that logic escapes
the product's own test suite and the type checker's view of the operation
contract. Keeping handlers thin means the compiler proves the CLI calls each
product correctly.

### R3 — The engine package is the whole contract

Products import our engine package and nothing else for CLI purposes. No
third-party type appears in a product's exports, whether or not the engine
internally wraps a third-party framework.

**Why:** whatever sits in the public interface between our packages can only
be replaced by coordinating simultaneous releases across every repo. Keeping
third-party primitives out of that interface bounds our exposure: swapping the
engine's internals is one package's problem, not an ecosystem event.

### R4 — Products receive a context, never the environment

Product code never reads engine-owned state directly: the process
environment, the process streams, TTY state, and the CLI's configuration
reach a handler only through one typed context object, which carries its
validated config section, credentials, the invocation's `cwd` and `env`,
and the output surface. The output surface is a typed result and event
sink — it exposes no writable streams and no way to exit the process;
rendering and exit codes stay in the engine (R5), and the process ends
only through the runtime's exit proxy, which the engine alone calls.

This does not prohibit product-domain disk access. Reading the user's
project — including Composer importing the user's own modules at
execution time under R9 — is a product's job, done inside the handler
and anchored at the context's `cwd` (with `requireDependency` on the
context resolving optional dependencies from the user's project per
R13). What is banned is reaching around the context to process globals.

**Why:** three reasons. Cross-cutting state — above all authentication
credentials, which Composer needs even when the user authenticated through a
Cloud command — has to flow somewhere, and handing it in as context is
strictly simpler than sharing the read-it-off-disk logic between packages.
Products that never touch the environment are agnostic about runtime (node,
bun, deno) by construction. And a handler whose whole world arrives as one
argument is trivially fakeable in tests.

### R5 — Products have no presentational API

Products supply words and structure: command descriptions, flag names,
examples, structured errors. They cannot print, color, format, or exit —
the interface offers no way to express it. Help layout, ANSI and color
policy, error rendering, `--json` envelopes, streaming format, and exit
codes are implemented exactly once, in the engine.

**Why:** our CLIs were authored in different years by different teams with
different goals, and it shows: help text, phrasing, error codes, visual
display, color handling — none of it is consistent, and convention (style
guides, review comments) demonstrably did not hold the line. Consistency has
to be structural: a product that cannot render cannot diverge. This is the
constraint the rest of the design serves.

Two clarifications. First, this requirement constrains *who owns* rendering,
not how it is built: the engine may adopt its internal framework's renderer
wherever that output satisfies the CLI Style Guide — custom rendering is the
escape hatch for what the framework cannot express, not the default. (The
hand-rolled help formatter in the current ORM CLI exists because its
framework rendered badly, not because owning the pixels is a goal.) Second,
there are no global flags: a flag like `--json` is declared per command —
many commands legitimately don't accept it — and the engine provides a
shared flag-set so the commands that do support it declare it uniformly.

### R6 — Errors and results follow the settled conventions

Every user-surfaced failure is a structured error built at its origin, with a
dotted namespace code, carried in the shared `Result` shape with the single
`ok` discriminator. The engine maps failures to the error envelope and exit
codes uniformly (0 ok; 1 bug only; 2 expected failure; 3 user abort).

**Why:** these rules are already accepted and shipping (prisma/prisma ADR 239
and ADR 245; Composer ADR-0043/0044). The engine is where they become visible
to users, so it must implement them once rather than trusting each product's
rendering. Machine consumers — agents, CI — branch on `ok`, `code`, and exit
codes; that only works if exactly one code space and one envelope exist.

### R7 — Product-repo end-to-end tests are first-class

A product can instantiate the engine with only its own commands and run real
argv-in, bytes-out tests in its own repository. Production is the same
machinery, so those tests are valid evidence about the shipped CLI.

**Why:** piloting the operations client alone misses whatever happens in real
CLI execution — parsing, context handoff, rendering, exit codes. If products
cannot test that in-repo, every CLI regression is discovered late, in the
shell's repo, by someone who didn't make the change. The engine being
instance-based (no global state) is what makes this possible; it is a hard
requirement on any framework we adopt or build.

### R8 — The shell's test burden is integration proof

The shell end-to-end tests the happy path of each product's critical
operations: the mounted tree, config handoff, and auth context demonstrably
work. Exhaustive error-case testing stays in product repos.

**Why:** the shell must prove composition works — that is the one thing only
it can test. Duplicating the products' error matrices there would rot and
would blur who owns which guarantee. Cheap for the shell, exhaustive in the
product: each test lives where its failure would be introduced.

### R9 — Static tree, lazy guts

Command definitions are cheap and load at startup; heavy dependencies load
inside handlers at execution time. No dynamic or discovery-driven tree
construction: each engine instance builds its tree once at startup from
statically defined structure — command definitions are direct function
references, and nothing about the tree is discovered at run time.

**Why:** a statically known tree is simpler to reason about, renders complete help without executing product code, and fails at build time when it is wrong. The expensive parts — driver stacks, Composer's dependency tree (which imports the user's own modules and has crashed at import in the past) — stay out of the startup path, so `prisma db migrate` can never be taken down by a product it isn't using. The split follows the existing design for isolating heavy dependency subtrees behind execution-time imports.

### R10 — One config chain, validated by its products, never a crash

*(Amended 2026-08-25: resolution grew from one file in cwd to a discovered chain of files, merged per key. The lazy-read, per-section, never-crash rules below predate that change and survive it unchanged.)*

The engine resolves a chain of `prisma.config.ts` files, and it resolves it only when the running command needs it. A command declares the section it needs; a run whose command declares none never opens a file, never pays for the loader, and cannot be failed by a broken config. Each product contributes a named section and a never-throwing validator; validation produces per-section diagnostics, and a command fails only if a section it needs is invalid. "Never a crash" covers loading too: a file that fails to import or evaluate — a syntax error, a throwing top-level statement — is caught by the engine and surfaced as a typed file-level diagnostic naming that file, never a stack trace.

Discovery collects every `prisma.config.ts` from the anchor directory upward, stopping at the repository boundary: the first directory containing a `.git` entry, that directory included. No `.git` at or above the anchor means the anchor directory alone — the filesystem root and the home directory are never reached implicitly, because every file on the chain is executed TypeScript and nothing outside the repository runs without explicit consent. The anchor is the current directory; with the engine-owned `--config <path>` flag it is the named file itself, which becomes the nearest link of the normal chain — its ancestors and `parent` declarations apply as usual, and the current directory's lineage never does. A file can steer the chain with the reserved top-level key `parent`: `parent: false` means "I am the last file, collect nothing above me"; `parent: "path"` names the next file explicitly, resolved against the declaring file's directory, allowed to cross the repository boundary (naming the file is the consent — the git-submodule case), and cycle-checked; an absent `parent` lets automatic discovery continue upward from the file's own directory.

Absence is treated per how the file entered the chain. Discovery finding no file anywhere is not an error — the section validators own absence and supply their defaults. A file named by `--config` that is not there IS an error, `CLI.CONFIG_NOT_FOUND`, because the user said which file to run against and the CLI would otherwise run against different settings; a file a `parent` key names that is not there is likewise an error, `CLI.CONFIG_PARENT_NOT_FOUND`. A broken file anywhere on the chain fails the command with a diagnostic naming that file; no skipping.

Sections resolve per key over the chain, the most-local value winning — the layering model ESLint and tsconfig users already know. A nested file shadows only the keys it actually writes, so a repository-root `skills: { check: false }` reaches every subdirectory that does not override it, and a root-level section falls through to subdirectories that never mention it. Merge semantics belong to the section's owner: `ConfigSection` carries an optional `merge(parent, child)`, and the engine default — for sections that do not customise — merges per key at the section's top level and replaces below. Required-section validation runs after the merge, on the resolved view, so a nested partial and a root partial may complete each other; a validator sees one value, plus that value's provenance as a second argument (`validate(raw, provenance)` — a one-argument validator remains a valid implementation). Merging never mutates a file's frozen export. Every resolved value carries provenance — which file contributed it, per top-level key — so post-merge diagnostics name the file to fix, and a relative path in a config resolves against the file that declared it, never against cwd or the nearest config: a section with path-valued keys resolves each in its validator through the engine's `resolveSectionPath(provenance, key, path)` and returns absolute paths, so downstream command code never resolves them again. There are no shadowing notices: overriding a parent's key is the mechanism working as intended.

The intended layout this serves is the two-config monorepo: one `prisma.config.ts` at the repository root carrying repository-wide settings (deploy target, `skills`), one in the database package carrying its `orm` section. From inside the package, ORM commands read the package's `orm` section; root-scoped sections fall through to the root file; a root `skills.check: false` reaches the package. Neither file names the other — discovery wires them together.

The version-marker contract is exact, and it applies to every file on the chain. The engine package owns both sides of it: its `definePrismaConfig` stamps the exported config value with a `$prismaConfig` field carrying the config contract version, and its loader checks that field on each file before interpreting anything else. Each failure mode has its own typed, file-level diagnostic carrying the failing file's path: an evaluated file without the marker (in particular a classic Prisma 7 config, which uses the same filename) fails early with `CLI.CONFIG_MISSING_MARKER`; a marker declaring a version this CLI does not support — older or newer, future markers included — fails with `CLI.CONFIG_VERSION_UNSUPPORTED`; a file that cannot be evaluated at all fails with `CLI.CONFIG_UNREADABLE`; a file named by `--config` that does not exist fails with `CLI.CONFIG_NOT_FOUND`; a top-level key that is not a section name fails with `CLI.CONFIG_UNKNOWN_SECTION`, per the next paragraph; and the `parent` directive has its own three — `CLI.CONFIG_PARENT_INVALID` for a value that is neither `false` nor a path string, `CLI.CONFIG_PARENT_NOT_FOUND` for a named parent that is not there, `CLI.CONFIG_PARENT_CYCLE` for a link that closes a loop. Those eight are every file-level config diagnostic there is. `CLI.CONFIG_NOT_FOUND` covers the `--config` file and nothing else: a chain that discovery leaves empty is deliberately not an error, so that code never appears for a run without the flag. One further code exists and is not file-level: a command's own section failing its validator is `CLI.CONFIG_SECTION_INVALID`, which names the section and, through provenance, the contributing files. Each code means one thing, so a consumer branching on it can tell a config written for another CLI from a bad field in one section. No best-effort reading of unmarked files.

The set of top-level keys is closed, and the check runs per file. Every top-level key names a config section, and the recognised names are exactly the sections the mounted commands and command families declare — so an unrecognised key is reported rather than ignored, and a settings block the user wrote in good faith never disappears in silence, even in a nested file whose sections the running command resolved elsewhere. The engine applies this check itself, in the same place it validates a command's own section, and not in the config loader: the loader is a member of the injected `Runtime`, so a check that lived there would hold only for as long as every host wired a loader that performed it. Two consequences are part of the requirement. First, an unrecognised key is a problem with a file's shape rather than with one section's content, so it is a file-level diagnostic and it fails every command that declares a config section, while commands that need no config keep working. That reach is deliberate: per-section isolation covers a section's content, which is where one product's mistake must not reach another product's commands, and a file whose shape the CLI cannot account for is not a problem any single section owns. Second, the recognised set is derived from the command families and commands a given binary mounts, so a config file's validity depends on the build as well as on the `$prismaConfig` marker — and of those two, only the marker is visible in the file.

Section names are constrained, and the constraint is enforced when the CLI is constructed rather than when a user runs it. A section may not be named `extends`, which config loaders read as an instruction to merge another file in; nor `parent`, which is the engine's chain directive above; nor `__proto__`, which object merging drops rather than let a config file reach a prototype; nor anything beginning `$`, which the file format keeps for metadata (`$prismaConfig` is the version marker itself). A command or command family that declares such a section fails at construction, so the mistake is a build-time failure for a contributor and never a runtime surprise for a user.

**Why:** the unified CLI claims a filename Prisma 7 already owns; a silently misparsed v7 file is the worst launch bug available, so detection is a structural marker, not a heuristic. Per-section diagnostics exist because one product's config problem must not brick the other products' commands. Reading the chain only for commands that need it follows the same logic one step further: a product's broken config cannot reach a command that never asked for config. Chain discovery with per-key merging exists for the monorepo layout above, which is already the mainstream pattern; the repository-boundary stop exists because chain files execute, so where they may come from must be bounded by something the user controls. And validators that throw turn a user's typo into a stack trace instead of a diagnostic with a fix.

### R11 — Pinned versions, tandem releases

The shell pins exact product versions. Shipping a product change to users
means releasing the shell with a bumped pin; release automation or workflow
glue makes that cheap, and no version ranges are used.

**Why:** with ranges, two users on the same shell version can run different
product code — support and reproducibility poison. Exact pins mean a shell
version fully determines behavior. The cost is tandem releasing, which is
tedious but simple, and simplicity wins.

### R12 — The shell defines the command tree

Products export commands; the shell decides where each one mounts. A command's
path in the tree does not appear in the product's code or its interface.

**Why:** the tree is a whole-CLI concern, and the evidence is its own history:
defining the consolidated tree took roughly six months of iteration by the
responsible product manager, coordinating renames and regroupings across
product lines (`app` → `service`, `database` → `postgres`, standalone
`format` folded into `contract format`) that no product would have made
locally. From a product's point of view the path is purely cosmetic — the
real invocation is the command and its arguments, and a product's in-repo
e2e tests exercise exactly that by mounting the command at any path. From
the shell's point of view the tree is structural: central definition makes
path collisions impossible and keeps the shipped tree checkable against the
agreed grammar in one place.

### R13 — The CLI is never a package manager

The CLI never installs, downloads, or vendors packages on its own
initiative or into its own hidden state — no self-installing command
modules, no hidden `node_modules`, no package store of its own, ever.
Components that only some commands need are declared as optional peer
dependencies; a command that requires one checks for it at execution time
and, when it is absent, returns a structured error naming the dependency
and how to install it with the user's own package manager.

Running the user's own package manager is a different act, and a command may do it: adding dependencies to the project the user is working in, or running a package's binary once, because the user asked for it. The case this exists for is a scaffolding command like `prisma orm init`, which sets up a project and then installs the dependencies it just wrote into `package.json`. A command declares that it installs packages, and the work goes through the engine's package operations, whose terms are what keep the two apart. The manager is the one the user's project already uses, detected rather than imposed. The command line is announced before it runs, and the manager's own output is shown while it runs, so nothing happens the user cannot see — with any credentials in either stripped out, because being visible to the user must not mean being visible in a log or a `--json` stream. A failure comes back as a structured error whose remedy carries that same redacted command, not a runnable one: whoever put a credential into a package specifier still holds it and can supply it again, so printing it back to save them that step buys a moment's convenience and risks writing the credential permanently into a CI log, where it cannot be taken back. One unconditional rule is worth more than a rule plus an exception, and an exception carved into the component whose job is not leaking secrets is where the leak would live. And the engine composes the command but never spawns it: execution belongs to the shell, so the engine holds no process-spawning machinery of its own.

**Why:** a previous incarnation of the Prisma CLI installed command
submodules on demand into a hidden `node_modules` in the working directory.
That approach is compatible with exactly one package manager and produces
edge cases everywhere else — lockfiles that lie, deduplication that never
happens, state the user cannot see or clean. The fault was never running a
package manager; it was the CLI running one for its own purposes, in a
place the user could not inspect. An install the user asked for, performed
by their own manager in their own project, leaves behind ordinary project
state they own and their tools already understand. The user already has a
package manager; the CLI's job is to drive it in the open or to say
clearly what is missing, not to become a second, worse package manager.
Both structured errors here — the missing optional dependency and the
failed package-manager run — follow R6 like every other expected failure.

### R14 — One event vocabulary, engine-defined, with product extensions

Commands report progress as structured events in a vocabulary the engine
defines: generic, CLI-shaped concepts (steps, warnings, remediation,
child-process output, endpoints) with consistent fields the engine knows how
to present in both human and `--json` modes. Products must fill and
primarily use those common fields. Alongside them, an event may carry
product-populated extension data: context-dependent structures the product
defines, versions, and documents as part of its own public API — the engine
passes them through to `--json` consumers untouched and does not enforce
them. A structure recurring across commands or products is the signal that
the engine vocabulary is missing a concept and should adopt it.

**Why:** two event dialects already evolved independently (Composer's
per-operation event unions; the ORM's progress spans), which is the machine-
surface version of the presentational drift R5 exists to kill — one
vocabulary means agents and CI learn one language for the whole CLI. But a
strictly closed vocabulary would either lose product-specific facts or grow
by fiat; the extension field keeps machine consumers fully informed, puts
the compatibility burden where the knowledge is (the product publishes its
extension interfaces), and gives the vocabulary an evidence-driven growth
path instead of speculation.

## The engine's internals

Decided (Will Madden, 2026-08-09): the engine wraps **@stricli/core**,
fully hidden per R3 — no stricli type appears in the engine's public
interface, so the internals remain replaceable.

The decision followed the evaluation rubric recorded in prisma/prisma at
[`docs/architecture docs/research/commander-friction-points.md`](https://github.com/prisma/prisma/blob/main/docs/architecture%20docs/research/commander-friction-points.md)
(the directory really is named `architecture docs`, space included). Commander
was ruled out there. Clipanion, the incumbent candidate with in-house
precedent, passes the rubric's nine technical criteria but fails the tenth:
at decision time its last publish, 4.0.0-rc.4 (2024-09-06), was 23 months
old with its 4.x line in release-candidate state for three years, and its
latest stable release, 3.2.1, dated from June 2023. Stricli — evaluated at
`@stricli/core` 1.3.0 (published 2026-07-16), the version the engine now
pins exactly — passes all ten: zero runtime dependencies, no `node:`
imports, no `process.exit` (verified against the published 1.3.0
artifact), per-invocation injected context, static
route maps with lazy command loading, parse-time validation with typed
errors, active institutional maintenance — and its known limitations
(per-command flags only, fixed help layout without formatter replacement)
are neutralized or made irrelevant by this document's own rules (R5's
engine-owned rendering; the no-global-flags rule).
