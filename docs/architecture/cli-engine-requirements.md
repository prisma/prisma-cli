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

Product code does not read disk, environment variables, or the TTY. Handlers
receive one typed context object carrying their validated config section,
credentials, and the output surface.

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
inside handlers at execution time. No dynamic discovery, no runtime tree
construction.

**Why:** a statically known tree is simpler to reason about, renders complete
help without executing product code, and fails at build time when it is wrong.
The expensive parts — driver stacks, Composer's dependency tree (which imports
the user's own modules and has crashed at import in the past) — stay out of
the startup path, so `prisma migrate` can never be taken down by a product it
isn't using. The split follows the existing design for isolating heavy
dependency subtrees behind execution-time imports.

### R10 — One config file, validated by its products, never a crash

The engine discovers and evaluates one `prisma.config.ts`. Each product
contributes a named section and a never-throwing validator; validation
produces per-section diagnostics, and a command fails only if a section it
needs is invalid. The config value carries a version marker written by
`defineConfig`; an evaluated file without the marker (in particular a classic
Prisma 7 config, which uses the same filename) fails early with a clear,
typed error. No best-effort reading of unmarked files.

**Why:** the unified CLI claims a filename Prisma 7 already owns; a silently
misparsed v7 file is the worst launch bug available, so detection is a
structural marker, not a heuristic. Per-section diagnostics exist because one
product's config problem must not brick the other products' commands. And
validators that throw turn a user's typo into a stack trace instead of a
diagnostic with a fix.

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

### R13 — The CLI never touches a package manager

The shell does not install, download, or vendor packages at runtime — no
self-installing command modules, no hidden `node_modules`, ever. Components
that only some commands need are declared as optional peer dependencies; a
command that requires one checks for it at execution time and, when it is
absent, returns a structured error naming the dependency and how to install
it with the user's own package manager.

**Why:** a previous incarnation of the Prisma CLI installed command
submodules on demand into a hidden `node_modules` in the working directory.
That approach is compatible with exactly one package manager and produces
edge cases everywhere else — lockfiles that lie, deduplication that never
happens, state the user cannot see or clean. The user already has a package
manager; the CLI's job is to declare what it needs and say clearly what is
missing, not to become a second, worse package manager. The structured
"optional dependency missing" error follows R6 like every other expected
failure.


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

The decision followed the evaluation rubric recorded in prisma/prisma's
`docs/architecture docs/research/commander-friction-points.md`. Commander
was ruled out there. Clipanion, the incumbent candidate with in-house
precedent, passes the rubric's nine technical criteria but fails the tenth:
at decision time its last publish was 23 months old with its 4.x line in
release-candidate state for three years. Stricli passes all ten — zero
runtime dependencies, no `node:` imports, no `process.exit` (verified
against the published artifact), per-invocation injected context, static
route maps with lazy command loading, parse-time validation with typed
errors, active institutional maintenance — and its known limitations
(per-command flags only, fixed help layout without formatter replacement)
are neutralized or made irrelevant by this document's own rules (R5's
engine-owned rendering; the no-global-flags rule).
