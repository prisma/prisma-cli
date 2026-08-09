# Stricli vs clipanion as the CLI engine's internal framework

Snapshot: 2026-08-09. Research-only evaluation of `@stricli/core` 1.3.0
(Bloomberg) against the 10-criterion rubric in
`docs/architecture docs/research/commander-friction-points.md` and the engine
requirements R1–R13 in
`wip/repos/prisma-cli/docs/architecture/cli-engine-requirements.md`.
Compared point-by-point with clipanion 3.x (the currently chosen internals).

Evidence base: the published package (`npm pack @stricli/core@1.3.0`, type
declarations `dist/index.d.ts` and the built `dist/index.js` read in full),
the docs site (bloomberg.github.io/stricli), the GitHub repo via API, npm
registry data, and the composer repo's living clipanion usage
(`packages/0-framework/3-tooling/cli/src/cli.ts`). Line references below are
into the unpacked `dist/index.d.ts` of 1.3.0.

## Verdict

**Strong contender — the comparative prototype spike is justified.**

Stricli scores **10/10** on the rubric (clipanion: 7/10). It passes every
criterion clipanion passes, and it passes criterion 10 (maintenance), which is
clipanion's only hard failure — and clipanion's position there has worsened
since the friction doc was written (last push 2024-09-06, now ~23 months ago;
4.0 still in RC after 3 years; stable 3.2.1 dates from June 2023). Stricli is
also a better structural fit for R9 and R12 than clipanion: its command tree
is literally a static route map built by the mounting side, with lazy handler
loading as a first-class, documented feature. The weaknesses section below
lists real warts (negative internal exit codes, no parse-only API, limited
help-layout customization, single primary maintainer), but none is
disqualifying for our wrap-everything design, and several disappear entirely
because we render output ourselves (R5).

## Rubric score table

Criteria abbreviated; full text in commander-friction-points.md ("Concrete
evaluation criteria for the replacement").

| # | Criterion | Stricli | Clipanion | Winner |
|---|-----------|---------|-----------|--------|
| 1 | Never calls `process.exit` from parse/dispatch; no message string-matching needed | **Pass.** Zero occurrences of `process.exit(` in `dist/index.js`/`index.cjs` (verified by grep). `run()` sets `context.process.exitCode ??= exitCode` on the *injected* process object (d.ts:1757; index.js `run` impl). Failure classes are typed constants in the exported `ExitCode` object (d.ts:1547–1580). | **Pass** (friction doc: `cli.run` returns exit code as a promise; caller sets `process.exitCode`). | Tie |
| 2 | Injected `{stdout, stderr, env}` per invocation, no globals | **Pass.** `run(app, inputs, context)` requires a context whose `process` is a `StricliProcess` — `{stdout, stderr, env?, exitCode?}` with a minimal structural `Writable` (`write`, optional `getColorDepth`) (d.ts:4–46). Verified in the built JS: every `process` reference is a function parameter fed from the context; no global reads. Docs ("Isolated Context"): "this indirection allows for injecting alternate implementations without hot-swapping globals." | **Pass** (friction doc; composer's `run(argv)` passes streams via clipanion context). | Tie |
| 3 | Help, errors, command output all go to the injected streams | **Pass.** All framework output (help text, parse errors, did-you-mean, integration errors) is written via `context.process.stdout/stderr` (verified in `dist/index.js`; e.g. the integration-error path writes `context.process.stderr.write(...)`). | **Pass**, with the caveat of open issue [arcanis/clipanion#176] (errors to stdout instead of stderr in some paths), which the migration-CLI swap works around with parse-only `cli.process`. | Stricli (no known stream-routing bug) |
| 4 | `parse(argv, ctx)` signals success/failure structurally | **Pass with note.** `run()` returns `Promise<void>` and communicates the exit code by assigning `context.process.exitCode` — we read it off the injected object we own. Codes are the typed `ExitCode` constants: `0` success, `1` command threw, negative codes for framework-level failures (`-4` InvalidArgument, `-5` UnknownCommand, `-2` CommandLoadError, `-3` ContextLoadError, `-1` InternalError, `-10` IntegrationError) (d.ts:1547–1580). `determineExitCode?: (exc: unknown) => number` in `ApplicationConfiguration` (d.ts:593) maps a thrown value to a code. No string matching anywhere. | **Pass** (`cli.run` resolves to the exit code directly — slightly cleaner shape). | Tie (clipanion's return shape is nicer; stricli's codes are more finely discriminated) |
| 5 | Help generated from the same declarations the parser uses | **Pass.** One declaration per parameter: `flags: { verbose: { kind: "boolean", brief: "..." } }` etc. is both the parse spec and the help source. `Command` and `RouteMap` expose `brief`, `fullDescription`, `formatUsageLine`, `formatHelp` from those same objects (d.ts:1118–1155), and `generateHelpTextForAllCommands` walks the tree (d.ts:1356). Docs site's "No Magic" principle is exactly this: no parallel DSL. | **Pass** (friction doc: `usage = {…}` lives on the command class next to the typed option declarations). | Tie |
| 6 | Parse-time enum/constraint validation with structured errors | **Pass.** `kind: "enum"` flags with `values: readonly T[]` are validated during scanning; failure throws `EnumValidationError` carrying typed fields `externalFlagName`, `input`, `values`, `corrections` (d.ts:1443–1457). All nine scanner errors are exported subclasses of `ArgumentScannerError` with typed payloads (`FlagNotFoundError.corrections`, `UnsatisfiedPositionalError.limit`, …) plus a `formatMessageForArgumentScannerError` dispatcher (d.ts:1367–1386). This routes directly into our error envelope with no message parsing. | **Pass** (typanion validators produce structured errors at parse time). | Tie (stricli's error taxonomy is richer and flatter to consume) |
| 7 | Hook for unknown command/flag with "did you mean" | **Pass.** Built in: route scanning computes corrections via Damerau-Levenshtein with git's empirically-derived weights, configurable (`ScannerConfiguration.distanceOptions`, d.ts:428–446), and hands `{input, corrections}` to the replaceable `noCommandRegisteredForInput` formatter (d.ts:260–264). `FlagNotFoundError` also carries `corrections`. We inject our own wording; no internal error interception. | **Pass** (friction doc). | Stricli (suggestions computed for us, formatter injectable) |
| 8 | Command carries user-defined metadata without shims | **Pass with note.** `docs: { brief, fullDescription?, customUsage? }` on every command (d.ts:1612–1625) and `{ brief, fullDescription?, hideRoute? }` on route maps. No arbitrary free-form metadata bag (e.g. docs URL) — but under R1/R3 the engine builds stricli objects *from our own definition type*, which is where arbitrary metadata lives; the framework never needs to carry it. No WeakMap shims required either way. | **Pass** (class fields hold anything). | Tie in practice |
| 9 | Runtime-agnostic parser (no `node:*` imports) | **Pass, strongest possible form.** Zero runtime dependencies (`package.json`: no `dependencies` key; tagline "no dependencies"). Zero `node:` imports in the ESM build (the single grep hit in the CJS build is a tsup comment). All environment access goes through the injected context. Ships ESM + CJS + `.d.ts`; single file ~86 KB unminified. | **Pass with caveat**: clipanion needs a `platform/` shim layer and has open issue [arcanis/clipanion#178] (invalid `lib/platform/node.mjs` require). | **Stricli** |
| 10 | Healthy maintenance trajectory | **Pass.** 1.0.0 published 2024-10-01; 16 releases since, latest 1.3.0 on 2026-07-16; repo pushed 2026-08-07 (two days before this snapshot). 19 open issues, actively triaged (recent bugs like white-on-white help #140 and green-bleed help #170 fixed and released). ~699k weekly npm downloads. Bloomberg OSS project, Apache-2.0. Adopters beyond Bloomberg: **Sentry's `sentry-cli`** (getsentry/cli), MystenLabs ts-sdks, Matt Pocock's `evalite`, LaunchDarkly's MCP server, Inkeep agents, Hookdeck Outpost, xs-dev, and every Speakeasy-generated MCP CLI (which is where much of the download volume comes from). Bus factor caveat below. | **Fail** (friction doc, and worse now: last push to arcanis/clipanion 2024-09-06 — ~23 months; 4.0.0-rc.4 was the last publish, 4.0 in RC since 2023-07; stable 3.2.1 from 2023-06; 42 open issues accumulating). | **Stricli, decisively** |

**Totals: stricli 10/10, clipanion 7/10** (clipanion per the friction doc:
passes 1–9, fails 10). The friction doc's threshold: ≥8/10 is "a clear win
over Commander". Both clear it; only stricli clears criterion 10, which the
friction doc itself flags as the criterion that becomes more important "for a
larger surface" — exactly our case.

## Fit against R1–R13

- **R1 (one directly executable language).** Good fit. `buildCommand` /
  `buildRouteMap` / `buildApplication` are plain functions taking plain object
  literals — our engine vocabulary can be a thin typed layer whose output *is*
  the runnable stricli tree, no interpreter. Note the engine still owns its own
  definition type per R3, so there is one translation (ours → stricli's), same
  as with clipanion.
- **R2 (handlers end in typed operation calls).** Neutral/good. A stricli
  command function is `(this: CONTEXT, flags: FLAGS, ...args: ARGS) => void |
  Error | Promise<void | Error>` (d.ts:1103) — flags and positionals arrive
  fully typed; the `FLAGS` type parameter is checked against the parameter
  declarations in *both* directions (`FlagParametersForType<T>` maps every key
  of the handler's flags type to a required declaration, d.ts:910). Declaring
  a flag the type doesn't have, or omitting one it does, is a compile error.
  This is stronger inference than clipanion's per-field `Option.String(...)`
  class properties.
- **R3 (engine package is the whole contract).** Good fit. Everything is
  interface-typed and generically parameterized on `CONTEXT`; the objects
  `buildCommand` returns are opaque values we never re-export. Nothing forces
  stricli types into our public surface.
- **R4 (context, never the environment).** Direct match. Stricli's whole
  design is a context object bound as `this` in command functions, extended
  with whatever we add (docs: "Isolated Context"). `StricliDynamicCommandContext`
  supports a `forCommand(info) => CONTEXT | Promise<CONTEXT>` builder
  (d.ts:78–88) — per-invocation, possibly async construction of the
  handler-facing context (config section, credentials, output surface) after
  routing but before execution. This maps one-to-one onto our handler-context
  design. Parsers themselves also get the context (`InputParser<T, CONTEXT>`,
  d.ts:987), which clipanion's typanion validators do not.
- **R5 (engine renders everything).** Good fit with one design decision to
  make in the spike. Two viable postures:
  1. *Own rendering wholesale*: skip the `help`/`version` integrations
     (since 1.2 they are opt-in integrations, d.ts:1728/1755) and render help
     ourselves by walking the public tree — `RouteMap.getAllEntries()`,
     `Command.parameters` (flags with `brief`/`default`/`values`/`hidden`,
     positionals with placeholders), `brief`/`fullDescription` (d.ts:1118–1141).
     All parse metadata is on public readonly properties — no
     private-field spelunking like Commander's `defaultValue` (friction §8).
  2. *Own the text, let stricli lay it out*: replace the entire
     `ApplicationText` object (`localization: { text }`) — every error string
     and help header is a formatter we supply, receiving the *typed* error
     objects (d.ts:192–319).
  Parse/route errors are formatted by our functions and written to our
  streams either way. The one thing stricli insists on doing is the physical
  `stderr.write` of the formatted error inside `run()` — acceptable because
  both the string and the stream are ours; if we ever need the error as a
  value instead, see the "no parse-only API" weakness below.
- **R6 (structured errors, exit-code mapping).** Good fit. Scanner errors are
  typed classes → our envelope; `ExitCode` discriminates usage errors (−4/−5 →
  our 2) from bugs (−1/−2/−3 → our 1); `determineExitCode` maps handler
  throws. We read `context.process.exitCode` off our own injected object and
  translate before touching the real process (see weaknesses: never hand
  stricli the real `process`).
- **R7 (product-repo e2e tests, instance-based).** Direct match — this is the
  hard requirement, and stricli meets it structurally. `Application` is a
  value; `run(app, argv, context)` is a pure-ish call over injected streams;
  no module-level state anywhere in the bundle (verified). A product mounts
  its commands in a throwaway route map and runs argv-in/bytes-out in its own
  repo with a `{ process: fakeStreams }` context. The docs advertise exactly
  this testing story.
- **R8 (shell integration proof).** Neutral — same machinery, no obstacle.
- **R9 (static tree, lazy guts).** Direct match, better than clipanion.
  Route maps are built eagerly at startup from cheap declarations; each
  command takes either `func` (inline) or `loader: () => Promise<CommandModule
  | CommandFunction>` (d.ts:1107–1113, 1637–1648) — the dynamic import of the
  heavy handler module happens only when that command is actually executed,
  *after* routing and before argument parsing. Help renders from the static
  declarations without ever invoking the loader. A loader failure is its own
  exit class (`CommandLoadError`, −2) with its own formatter
  (`exceptionWhileLoadingCommandFunction`), so "Composer's dependency tree
  crashed at import" becomes a classified, renderable failure rather than a
  startup crash. Clipanion has no built-in lazy-module story (its
  registration is runtime `cli.register` per class; stricli's own
  "Alternatives" page criticizes it for runtime command loading).
- **R10 (config).** Out of framework scope; nothing in stricli touches config
  files. No conflict.
- **R11 (pinning).** No conflict. Zero transitive dependencies makes exact
  pinning trivial and audit surface minimal.
- **R12 (shell defines the tree).** Direct match. A `Command` contains no
  path; paths exist only as keys in `buildRouteMap({ routes: { migrate:
  cmd } })` (d.ts:1673–1703), composed by whoever mounts. The same command
  value can be mounted at any path, at several paths, or under a test-only
  root in a product repo. Route-level `aliases` and `hideRoute` are also
  mounting-side concerns. This is structurally the R12 split.
- **R13 (no package manager).** Pass. Nothing self-installs; zero runtime
  deps; nothing interferes with optional-peer-dependency detection (a handler
  doing its own `import()` probe is untouched by the framework). The optional
  version-check feature (`getLatestVersion`) is opt-in and purely advisory;
  we simply don't enable it.

## Honest weaknesses of stricli

1. **Negative internal exit codes.** Framework failures set
   `context.process.exitCode` to −1…−10. POSIX exit statuses are 0–255; if
   the *real* `process` were passed as context, `-5` becomes exit 251. For us
   this is a mapping obligation, not a bug — the engine must always inject
   its own process facade and translate — but it is a trap for anyone who
   follows the docs' quickstart (`run(app, argv, { process })`) and expects
   sane shell-visible codes for usage errors.
2. **No parse-only public API.** `run()` is the only execution entry point
   (plus `proposeCompletions`). There is no exported "parse this argv against
   this command and give me the flags/route result without executing"
   function — `RouteScanResult` is a type you only meet inside integration
   hooks. Commander-style metadata recovery isn't needed (declarations are
   public), but if the spike finds we want parse-errors-as-values rather than
   parse-errors-as-formatted-strings, the workaround is a custom
   `ApplicationText` whose formatters capture the typed error object onto our
   context before returning a string — functional, slightly inelegant.
3. **Help layout is stricli's unless we render ourselves.** Section order,
   indentation, and column layout of `formatHelp` are not configurable beyond
   headers/keywords and a few booleans; issue #87 ("Customize usage/help
   layout", open since 2025-05) confirms. Under R5 we intend to render help
   ourselves anyway, which sidesteps this — but it means the spike must
   verify that walking `Command.parameters` gives us everything our formatter
   needs (it appears to: briefs, placeholders, defaults, enum values,
   optional/variadic/hidden are all in the public d.ts).
4. **No user-defined global flags across commands.** A flag like `--json`
   must either be declared on every command (our engine can inject it into
   every definition it builds — mechanical) or expressed as an
   application-level integration flag, which takes over the run like
   `--help` does. Open issues #146 ("Support application-level global
   flags") and #127 ("Root flags?") confirm this is a real gap upstream.
5. **Single-character flag aliases only.** `Aliases` is typed as one ASCII
   letter → flag name (d.ts:998–1001). No long-form alias (`--data-proxy`
   aliasing `--accelerate`); route-level aliases are unrestricted, flag-level
   are not. If we need long flag aliases for deprecation migrations, we
   declare a second hidden flag and merge in the handler — our engine can
   abstract that.
6. **CamelCase-first flag naming.** Flag names are TypeScript object keys, so
   multi-word flags are natively `camelCase`; kebab input/output is a scanner
   and display mode (`allow-kebab-for-camel` / `convert-camel-to-kebab`,
   d.ts:399, 453). Fine, but it is a convention the engine must set once
   (Prisma's user-facing flags are kebab-case) and the "original vs
   converted" duality shows up in APIs like `getOtherAliasesForInput`
   returning per-case-style records.
7. **Bus factor.** Contributor stats: molisani (Michael Molisani, Bloomberg)
   125 commits; next human contributor 30; everyone else ≤4. This is a
   one-primary-maintainer project with corporate backing — better than
   clipanion's one-maintainer-who-moved-on, and Bloomberg has kept it staffed
   for 22 months of releases, but it is not a multi-maintainer community.
   Mitigation is the same wrap-per-R3 posture that lets us swap internals.
8. **API still settling.** 1.2 deprecated the whole `DocumentationConfiguration`
   / `versionInfo` surface in favor of integrations (deprecation notices
   throughout the d.ts). Handled gracefully (deprecate, don't break), and it
   moved in a direction we like (help/version became optional), but expect
   some churn inside 1.x.
9. **Mandatory `brief` on everything** (issue #92). For us a non-issue — the
   engine requires descriptions anyway — noted for completeness.
10. **Docs gloss over `forCommand`.** The dynamic per-command context builder
    (`StricliDynamicCommandContext.forCommand`) is in the types but
    undocumented on the site (issue #126). We would rely on it for R4; the
    spike should exercise it explicitly.

## Clipanion-specific notes not in the friction doc

- Maintenance has degraded further since the 2026-04-30 snapshot: the repo's
  last push remains 2024-09-06 (now ~23 months), last npm publish is
  4.0.0-rc.4 (2024-09-06), and the stable 3.x line's last release is 3.2.1
  (2023-06-05). Open issues: 42. The friction doc's "re-evaluate criterion 10
  before adopting clipanion at larger scope" instruction, applied today,
  reads as a failure for this scope.
- Composer's living usage (`wip/repos/composer/packages/0-framework/3-tooling/
  cli/src/cli.ts`) confirms the pleasant parts: `run(argv)` returns the exit
  code, `UsageError` is a typed catchable, envelope mapping is a small
  try/catch. Nothing in that file argues against clipanion ergonomically —
  the case against it is purely criterion 10 plus the weaker R9 story.

## Bottom line for the spike decision

Stricli is not merely "clipanion with a pulse". It is a closer structural
match to this requirements document than clipanion on the three requirements
that shaped the engine design (R7 instance/context model, R9 static tree with
lazy loaders, R12 mounting-side route maps), it has the best
runtime-agnosticism profile of any candidate examined (zero deps, zero
`node:*`, all environment access injected), and its maintenance trajectory is
the strongest signal: 16 releases in 22 months, active triage, corporate
backing, and credible external adopters (Sentry CLI, Speakeasy, MystenLabs).
Run the comparative spike; the specific things the spike must prove are the
R5 own-rendering path (weakness 3), the `forCommand` context handoff
(weakness 10), and the exit-code translation layer (weakness 1).
