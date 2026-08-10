# v8 CLI port — extracted patterns (branch s2b-resources-work)

All paths relative to the repository root, on branch
`claude/prisma-cli-v8-onboarding-30e694`.

---

## 1. The v8 command-module pattern (packages/cli/src/v8/auth/)

Files: `login.ts` (101), `logout.ts` (79), `whoami.ts` (47), `workspace-list.ts` (122), `workspace-use.ts` (155), `workspace-logout.ts` (20), `run-workspace-logout.ts` (81), `workspace-shared.ts` (36), `state-card.ts` (52), `errors.ts` (58), `agent-setup-tip.ts` (69).

### Per-file structure

**whoami.ts** — the minimal template. Exports `authWhoamiCommand = defineCommand({...})`. Structure:
- module-level constants for the human title and shared NextActions:
  ```ts
  const TITLE = "Showing the current authenticated identity.";
  const SIGN_IN: NextAction = { kind: "run-command", label: "Sign in", command: `${CLI_NAME} auth login` };
  ```
- a private `presentationsFor(state): Presentations` function that builds `human` / `stdout` / (`json`) / `next` closures from the operation result;
- the `defineCommand` call: `help` (summary + examples), no `args`, no `needs`, `handler: async (_args, ctx) => {...}`;
- the handler calls the mocked-in-tests operation module (`readAuthState(ctx.env, ctx.signal)`), catches the known legacy error (`isEmptyServiceTokenError`) and returns `notOk(authConfigInvalidError(error.message))`, otherwise rethrows (engine settles a rethrow as `CLI.INTERNAL_ERROR`, exit 1);
- success returns `ok(ctx.present({ data: state }, presentationsFor(state)))` — the raw operation result IS the json-envelope `result` when no `json()` presentation is supplied.

**login.ts** — adds event reporting. Handler emits `ctx.report({ kind: "step-started", step: LOGIN_STEP })`, `{ kind: "endpoint", name: "verification", url }` (via an operation callback), `{ kind: "step-finished", step, outcome: "ok" | "failed" }`. On operation throw it reports the failed step-finished then rethrows. `nextActionsFor(state)` builds the follow-up list including a conditional agent-setup-tip action.

**logout.ts** — declares a flag:
```ts
args: { flags: { workspace: flag.string({ brief: "Remove one stored OAuth workspace session", placeholder: "id-or-name" }) } }
```
When `--workspace` is passed the handler delegates to the shared operation function `runWorkspaceLogout(ctx, workspaceRef)` (same semantics/presentation as `auth workspace logout` — no argv re-dispatch).

**workspace-list.ts** — the list/table template. Exports `serializeAuthWorkspaceList(result)` (the explicit json shape: `{ context: {...}, items: [...], count }`) so tests can reuse it; a `workspaceTableRows(result)` helper computing `{ columns, rows }` with a conditional column (source column only when sources are mixed); `listPresentations(result)` supplies all four functions:
```ts
{ human: () => [...blocks], stdout: () => table.rows.map(r => r.join("  ").trimEnd()),
  json: () => serializeAuthWorkspaceList(result), next: () => (empty ? [LOGIN_NEXT_ACTION] : []) }
```
Empty-state: human gets a `summary` block instead of the table; next gets the sign-in action.

**workspace-use.ts** — declares a positional:
```ts
args: { positionals: { workspace: positional.optionalString({ brief: "Workspace id or exact name", placeholder: "id-or-name" }) } }
```
When absent, a private `selectWorkspaceRef(ctx)` runs interactive selection: env guard throws `CliStructuredError` (`AUTH.WORKSPACE_SWITCH_UNAVAILABLE`), zero switchable throws `AUTH.USAGE_ERROR`, one auto-selects, several run `ctx.prompt.select("Select a workspace", options)`. Thrown `CliStructuredError`s from helpers settle as errored envelopes (exit 2). Operation errors are mapped: `const mapped = mapAuthOperationError(error); if (mapped) return notOk(mapped); throw error;`.

**workspace-logout.ts** — thin definition (`positional.string`, required), handler is one line delegating to `runWorkspaceLogout`.

**run-workspace-logout.ts** — the shared-operation pattern for a command body reachable from two mounts:
```ts
export async function runWorkspaceLogout(
  ctx: CommandContext<undefined, never>,
  workspaceRef: string,
)
```
Validates input (`notOk(workspaceRequiredError())` for blank), runs the operation, maps errors, presents.

### Shared presentation helpers

**state-card.ts** — pure functions over the domain result:
```ts
export interface FieldRow { readonly label: string; readonly value: string; }
export function providerLabel(provider: AuthProviderId): string
export function userLabel(state: AuthStateResult): string | null
export function authStateFieldRows(state: AuthStateResult): readonly FieldRow[]
```
The rows serve both the human `fields` block and the `stdout` lines (`rows.map(row => `${row.label}: ${row.value}`)`).

**workspace-shared.ts** — constants + tiny glue shared by the family:
```ts
export const LIST_NEXT_ACTION: NextAction = { kind: "run-command", label: "List authenticated workspaces", command: `${CLI_NAME} auth workspace list` };
export const LOGIN_NEXT_ACTION: NextAction = { kind: "run-command", label: "Sign in", command: `${CLI_NAME} auth login` };
export function operationContext(ctx: CommandContext<undefined, never>): WorkspaceOperationContext  // { env: ctx.env, signal: ctx.signal }
export function rethrowMapped(error: unknown): never  // throw mapped ?? original
```

### errors.ts — legacy CliError → structured mapping

```ts
const AUTH_CODE_MAP: Readonly<Record<string, `${string}.${string}`>> = {
  AUTH_CONFIG_INVALID: "AUTH.CONFIG_INVALID",
  WORKSPACE_SWITCH_UNAVAILABLE: "AUTH.WORKSPACE_SWITCH_UNAVAILABLE",
  WORKSPACE_NOT_AUTHENTICATED: "AUTH.WORKSPACE_NOT_AUTHENTICATED",
  WORKSPACE_AMBIGUOUS: "AUTH.WORKSPACE_AMBIGUOUS",
  USAGE_ERROR: "AUTH.USAGE_ERROR",
};

export function authConfigInvalidError(why: string): CliStructuredError {
  return new CliStructuredError("AUTH.CONFIG_INVALID", "Authentication configuration is invalid", {
    why,
    nextActions: [{ kind: "user-choice", label: "Provide a valid PRISMA_SERVICE_TOKEN value, or unset the variable to use local OAuth login." }],
  });
}

export function mapAuthOperationError(error: unknown): CliStructuredError | null {
  if (!(error instanceof CliError)) return null;
  const code = AUTH_CODE_MAP[error.code];
  if (code === undefined) return null;
  return new CliStructuredError(code, error.summary, {
    why: error.why ?? undefined,
    meta: Object.keys(error.meta).length > 0 ? error.meta : undefined,
    nextActions: error.fix ? [{ kind: "user-choice", label: error.fix }] : [],
  });
}
```
Mapping rules: flat legacy code → dotted `NAMESPACE.SUBCODE` (namespace = domain, subcode = code minus prefix); `summary` verbatim; `why` (null → undefined); `meta` preserved when non-empty; the legacy `fix` prose becomes exactly one `{ kind: "user-choice", label: fix }` nextAction. Unknown codes return `null`; callers rethrow so the engine settles them as a bug (`CLI.INTERNAL_ERROR`, exit 1). The notOk path: known/expected failures return `notOk(structuredError)` from the handler (exit 2, errored envelope); alternatively helper functions throw `CliStructuredError` directly and the engine settles it identically.

**agent-setup-tip.ts** — non-command helper taking a structural `{ cwd, env, signal }` context (satisfied by ctx) so it stays testable without the engine.

---

## 2. The engine surface on this branch

`packages/cli-engine/src/exports/index.ts` (80 lines) exports:
- from `../args`: `flag`, `positional`, types `Args, ArgsSpec, Char, CommandArgs, FlagSpec, PositionalSpec`
- from `../cli`: `createCli`, types `Cli, CliRunHooks`
- from `../command-family`: `defineCommandFamily`, types `CommandFamily, MountedTree`
- from `../commands`: `defineCommand, defineServerCommand, defineSessionCommand`, types `AnyCommand, CommandDefinition, CommandHandler, CommandHelp, CommandNeeds, CompletedEnvelope, ErroredEnvelope, Handler, HelpSpec, NeedsSpec, ServerCommandDefinition, SessionCommandDefinition`
- from `../config-loader`: `defineConfig, loadConfig`; from `../config-section`: `defineConfigSection`, types `ConfigSection, SectionValidation`
- from `../context`: types `CommandContext, Credentials, PromptSurface`
- from `../events`: types `EngineEvent, Severity, StreamEvent, StreamMeta`
- from `../management-api`: type `ManagementApiClient` (= re-export of `@prisma/management-api-sdk`'s `ManagementApiClient`)
- from `../presentation`: `PRESENTED`, types `Block, Format, Outcome, Presentations, PresentedResult, TreeNode, Ui`
- from `../run-summary`: types `EngineCommandSnapshot, RunSummary`
- from `../runtime`: `PRISMA_CONFIG_VERSION`, types `HostProcess, InputStream, LoadedConfig, OutputStream, Runtime`

`exports/protocol.ts` (subpath `@prisma/cli-engine/protocol`): `CliStructuredError`, `notOk`, `ok`, `okVoid`, types `CliErrorEnvelope, Diagnostic, NextAction, NotOk, Ok, Result`.
`exports/testing.ts` (subpath `@prisma/cli-engine/testing`): `createTestCli`, type `TestCli`.

### defineCommand (packages/cli-engine/src/commands.ts:186-215)

```ts
export function defineCommand<TFlags, TPositionals, TConfig = undefined, TCode extends number = never>(def: {
  readonly help: HelpSpec;                                  // { summary, description?, examples? } — examples without {bin} get the cli name prepended
  readonly args?: ArgsSpec<TFlags, TPositionals>;           // { flags?, positionals? }
  readonly needs?: NeedsSpec<TConfig>;                      // { config?, credentials?: true, dependencies?: readonly string[], interaction?: true }
  readonly exitCodes?: Readonly<Record<TCode, string>>;     // documented codes 4-99; keys type Outcome's exitCode (required at return sites when non-empty)
  readonly handler: Handler<TFlags, TPositionals, TConfig, TCode>;
}): CommandDefinition<...>
```
`Handler = (args: Args<F,P>, ctx: CommandContext<TConfig, TCode>) => Promise<Result<PresentedResult<unknown>, CliStructuredError>>`. Result kind is `"result-command"`. Also `defineSessionCommand` (returns `Result<void, ...>`, event-driven) and `defineServerCommand` (stdio handoff, returns exit code). `CommandHandler<typeof def>` types an out-of-file handler.

### flag.* / positional.* (packages/cli-engine/src/args.ts:60-105, 128-152)

```ts
flag.string<A>({ brief, placeholder?, alias?, default? })        : FlagSpec<string | undefined>
flag.requiredString<A>({ brief, placeholder?, alias? })          : FlagSpec<string>
flag.number<A>({ brief, placeholder?, alias?, default? })        : FlagSpec<number | undefined>
flag.boolean<A>({ brief, alias? })                               : FlagSpec<boolean>
flag.enum<const T, A>({ brief, values, alias?, default? })       : FlagSpec<T[number] | undefined>
flag.repeated<A>({ brief, placeholder?, alias? })                : FlagSpec<readonly string[]>
positional.string({ brief, placeholder })                        : PositionalSpec<string>
positional.optionalString({ brief, placeholder })                : PositionalSpec<string | undefined>
positional.variadic({ brief, placeholder })                      : PositionalSpec<readonly string[]>  // at most one, declared last
```
Alias is single-char (type-enforced `Char<A>`). Declared camelCase flag keys become `--kebab-case`. Reserved shared family (engine-injected): `--format/--json, --log-level/--verbose, --quiet, --yes, --interactive, --color`.

### ok / notOk / CliStructuredError (packages/cli-engine/src/protocol.ts)

`ok<T>(value): Ok<T>`, `notOk<F>(failure): NotOk<F>`, `okVoid()`. Ok/NotOk are frozen class instances with `assertOk()`/`assertNotOk()`.

`CliStructuredError` is a **class** (protocol.ts:53), constructed with `new`:
```ts
new CliStructuredError(
  code: `${string}.${string}`,   // dotted NAMESPACE.SUBCODE
  summary: string,
  options?: {
    severity?: "error" | "warn" | "info";   // default "error"
    why?: string;
    nextActions?: readonly NextAction[];    // default []
    where?: { path?: string; line?: number };
    meta?: Record<string, unknown>;
    docsUrl?: string;
    cause?: unknown;
  })
```
Members: `.toEnvelope(): CliErrorEnvelope` and static `CliStructuredError.is(error)` (duck-typed guard by `name === "CliStructuredError"`).

`NextAction` (protocol.ts:26):
```ts
export interface NextAction {
  readonly kind: "run-command" | "user-choice" | "edit-file" | "done";
  readonly label: string;
  readonly command?: string;
  readonly commands?: readonly string[];
  readonly reason?: string;
}
```

### CommandContext (packages/cli-engine/src/context.ts:14-95)

Fields: `config: TConfig`; `present<T>(outcome, presentations): PresentedResult<T>` (the only PresentedResult constructor; `Outcome<T,TCode>` = `{ data, diagnostics? }` plus `exitCode: TCode | 0` iff exitCodes documented); `getCredentials(): Promise<Credentials | undefined>` (`Credentials = { readonly token: string }`); **`api: ManagementApiClient` IS present** (lazy getter, see §6); `report(event: EngineEvent): void`; `prompt: PromptSurface`; `signal: AbortSignal`; `cwd: string`; `env: Readonly<Record<string, string | undefined>>`; `requireDependency(specifier): Promise<Result<void, CliStructuredError>>`.

### needs.credentials (packages/cli-engine/src/execution/needs.ts:104-153)

`checkNeeds` order: interaction → dependencies → credentials → config section. `checkCredentials` calls `runtime.getCredentials()`:
- throw → `CLI.CREDENTIALS_UNREADABLE`, summary "The stored credentials could not be read.", why = first line of the cause message, one user-choice action "Sign in again to replace the stored credentials, then run the command again."
- `undefined` → `credentialsRequiredError()` (needs.ts:138-152), the single sign-in error shared with ctx.api:
```ts
new CliStructuredError("CLI.CREDENTIALS_REQUIRED", "You must be signed in to run this command.",
  { nextActions: [{ kind: "user-choice", label: "Sign in, then run the command again." }] })
```
All needs failures settle as errored envelopes, **exit 2** (verified byte-exact in v8-whoami.test.ts:243-253). Other needs errors: `CLI.INTERACTION_REQUIRED` (needs.ts:70), `CLI.MISSING_DEPENDENCY` (needs.ts:253, with `run-command` install action when the package manager is known and `meta: { specifier, installCommand? }`), `CLI.CONFIG_INVALID` (needs.ts:194).

### Prompt surface + structural failure codes (packages/cli-engine/src/execution/prompts.ts)

`PromptSurface`: `confirm(question, { default? })`, `consent(question)` (no default parameter — structurally undefaultable), `select<T extends string>(question, options: {value,label}[], { default? })`, `text(question, { placeholder?, default? })`. Prompt UI writes to **stderr**.

Semantics: under `--yes` or non-interactive (no TTY stdin, CI, `--no-interactive`) a prompt with a default resolves to it silently; without a default it throws. Failure errors (all engine-settled):
- `CLI.PROMPT_REQUIRED` (prompts.ts:73) — no default, --yes or non-interactive. **Exit 2.**
- `CLI.CONSENT_REQUIRED` (prompts.ts:98) — consent under --yes/non-interactive; --yes can never grant. **Exit 2.**
- `CLI.PROMPT_INVALID` (prompts.ts:120) — unparseable answer, `"${raw}" is not a valid answer to "${question}".` **Exit 2.**
- `CLI.PROMPT_CANCELLED` (prompts.ts:66) — EOF/cancel at the prompt. **Exit 3.**
Scripted answers (test harness `answers`) bypass clack; prompting past the script throws a harness Error (test failure).

### Events (packages/cli-engine/src/events.ts)

`EngineEvent` kinds: `step-started` (`step`, `id?`, `parentId?`), `step-finished` (`step`, `outcome: "ok"|"failed"|"skipped"|"warning"`), `progress` (`completed`, `total?`), `message` (`severity: "warn"|"info"|"verbose"`, `text`), `output` (`source`, `channel: "data"|"diagnostic"`, `line`), `remediation` (`action: NextAction`), `endpoint` (`name`, `url`), `status` (`subject`, `status`, `from?`), `artifact` (`path`, `description?`). Every kind takes optional `data?: unknown` passthrough. Emitted via `ctx.report(...)`; rendered in human mode, framed as `StreamEvent` lines (`EngineEvent & { commandId, timestamp }`) in json mode; never aggregated into the envelope.

### Blocks + sensitive fields (packages/cli-engine/src/presentation.ts:78-105)

```ts
type Block =
  | { kind: "summary"; tone: "ok" | "error" | "warn" | "info"; text: string }
  | { kind: "fields"; rows: ReadonlyArray<{ label: string; value: string; sensitive?: boolean }> }
  | { kind: "table"; columns: readonly string[]; rows: ReadonlyArray<readonly string[]> }
  | { kind: "list"; items: readonly string[] }
  | { kind: "tree"; roots: readonly TreeNode[] };
```
`sensitive?: boolean` exists **only on fields rows**. `Presentations = { human: (ui: Ui) => Block[]; stdout?: () => string[]; json?: () => unknown; next?: () => NextAction[] }` — only the active format's functions run, at the return site (`command-context.ts:36-56`): json mode materializes `json` + `next`; human mode materializes `human` + `stdout` + `next`. When `json()` is absent the envelope `result` falls back to `data`. Human blocks + next + diagnostics render to stderr; `stdout()` lines are the only stdout writes (pipe-clean).

Guard in `ctx.present` (command-context.ts:74-83): a severity-"error" diagnostic with exitCode 0 throws (bug).

---

## 3. createTestCli — exact spec on this branch (packages/cli-engine/src/testing.ts:69-90)

```ts
export function createTestCli(spec: {
  readonly commandFamilies?: readonly CommandFamily[];
  readonly commands: MountedTree;                            // required
  readonly groups?: Readonly<Record<string, { readonly brief: string }>>;
  readonly config?: Readonly<Record<string, unknown>>;       // runtime.config.sections
  readonly credentials?: Credentials;                        // runtime.getCredentials resolves this (undefined = signed out)
  readonly managementApi?: { readonly baseUrl?: string; readonly client?: ManagementApiClient };
      // baseUrl defaults to "https://test.invalid"; when client is supplied, ctx.api IS that object
  readonly packageManager?: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  readonly now?: () => Date;                                 // fixed clock for stream timestamps
}): TestCli
```

`TestCli.run(argv, opts?)` (testing.ts:11-58) opts:
```ts
{ stdin?: string; answers?: ReadonlyArray<string | boolean>; abort?: AbortSignal;
  onEvent?: (event: EngineEvent) => void; onSettled?: (summary: RunSummary) => void;
  cwd?: string; isTty?: { stdin?: boolean; stdout?: boolean; stderr?: boolean };
  env?: Readonly<Record<string, string | undefined>> }
```
Result:
```ts
{ exitCode: number; stdout: string; stderr: string;
  json: readonly StreamEvent[];                       // parsed json-mode frames incl. terminal result
  events: readonly EngineEvent[];                     // every reported event
  presented: PresentedResult<unknown> | undefined }   // the handler's returned PresentedResult
```
Engine name in the harness is `"prisma-test"`, version `"0.0.0"`. Defaults: cwd `"/"`, env `{}`, all isTty false. `runtime.exit` throws. The `answers` script feeds prompts in order; prompting past it fails the test.

---

## 4. The v8 test pattern

### packages/cli/tests/v8-auth.test.ts (family suite)

- **Mock the operations module wholesale, keep the rest real**:
  ```ts
  vi.mock("../src/auth", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/auth")>()),
    performLogin: vi.fn(), performLogout: vi.fn(), readAuthState: vi.fn(),
    listAuthWorkspaces: vi.fn(), switchAuthWorkspace: vi.fn(), logoutAuthWorkspace: vi.fn(),
  }));
  ```
  Real error classes (`EmptyServiceTokenError`) and legacy error constructors (`workspaceAmbiguousError` from `../src/shell/errors`) are imported to script rejections.
- **Shared fixture constants** at module top (`SIGNED_OUT`, `SIGNED_IN`, `TWO_OAUTH_WORKSPACES`, `MIXED_SOURCES`, `EMPTY_LIST`).
- **`makeCli()`** builds `createTestCli({ commands: {<mount path>: command,...}, groups: {...}, now: () => new Date(0) })` — commands mounted flat by path, mirroring `cli.ts`; no commandFamilies in tests.
- **Result-frame extraction helper** (v8-auth.test.ts:135-141):
  ```ts
  function resultFrame(frames: ReadonlyArray<{ kind: string }>) {
    const frame = frames.at(-1);
    if (frame === undefined || frame.kind !== "result") throw new Error("expected a terminal result frame");
    return frame as Extract<StreamEvent, { kind: "result" }>;
  }
  ```
- **Envelope assertions**: run with `--json`, `resultFrame(result.json)`, then `expect(frame.envelope).toMatchObject({ ok, commandId: "auth.login", error: { code, summary, why?, meta? } })` or `result` for completed. Human-mode tests assert `result.stderr` `toContain` for cards/next-action lines (`"→ Sign in: prisma-cli auth login\n"`) and assert semantically via `result.presented?.presentation.stdout / .next / .human.find(b => b.kind === "table")`.
- **Events**: `expect(result.events).toEqual([...])` for the step/endpoint sequence.
- **Prompts scripted** with `answers: ["ws_2"]` + `isTty: { stdin: true, stdout: true }`; invalid answers assert `[CLI.PROMPT_INVALID]` exit 2; non-interactive (`isTty.stdin: false`) asserts `[CLI.PROMPT_REQUIRED]` exit 2.
- **Filesystem-dependent behavior** (agent tip) uses `mkdtemp` temp cwd + `env: { PRISMA_CLI_STATE_DIR }`.
- `beforeEach` resets every mock.
- Definition-shape assertion: `expect(authLoginCommand.needs.credentials).toBe(false)`.

### packages/cli/tests/v8-whoami.test.ts (S1 byte-pin baseline)

Same mock pattern (only `readAuthState`). Additionally:
- Byte-exact stderr/stdout pins for whoami (`expect(result.stderr).toBe("ℹ ...\n...")`), including the full json line for the envelope with fixed clock `T0 = "1970-01-01T00:00:00.000Z"`.
- **Unauthenticated path pattern** (v8-whoami.test.ts:31-44, 230-266): a local `requiresCredentials = defineCommand({ needs: { credentials: true }, ... })` mounted as `"auth locked"`, run with/without `createTestCli({ credentials: { token: "tok_1" } })`; asserts the byte-exact `CLI.CREDENTIALS_REQUIRED` rendering (exit 2) and success when credentials present.
- ctx.env passthrough test: asserts the mock was called with the exact `env` object passed to `run`.

### packages/cli/tests/v8-golden-rendering.test.ts

Header comment states the rule: byte-exact pins live ONLY here, **one representative per rendering surface** — currently: human card (`auth logout`), table (`auth workspace list`), error (`AUTH.WORKSPACE_AMBIGUOUS` via `auth workspace logout`). Every other v8 test asserts semantically. New commands are added here **only** if they introduce a new rendering surface; otherwise nothing is added — when the engine's rendering style changes, this is the one file re-pinned. Structure is the same makeCli/mocks pattern with `now: () => new Date(0)`.

---

## 5. Mount map + family map (packages/cli/src/v8/cli.ts)

`buildCli()` calls `createCli({ name: "prisma-v8", version: getCliVersion(), commandFamilies: [defineCommandFamily({ commands: { login: authLoginCommand, logout: ..., whoami: ..., workspaceList: ..., workspaceUse: ..., workspaceLogout: ... } })], groups: { auth: {...}, "auth workspace": {...}, telemetry: {...} }, commands: { "auth login": authLoginCommand, ..., "telemetry status": telemetryStatusCommand, ... } })`.

Notes:
- One `defineCommandFamily` for auth (family keys are camelCase names, mount keys are space-separated paths referencing the **same object identities**). Telemetry commands are mounted with **no family** ("Shell-owned consent surface").
- `defineCommandFamily` spec (command-family.ts:21-31): `{ configSection?, commands: Record<string, AnyCommand>, docsBaseUrl? }`. Family membership is **object identity**: `commandFamilyOf` (execution/command-tree.ts:136-143) finds the family whose `commands` record `.includes(def)`. Unowned (harness/shell) commands are allowed.
- Construction-time validation (command-tree.ts): path collisions, unknown groups (every path prefix must be a declared group), reserved-flag/grammar violations, exit-code range, **section ownership** (a command whose `needs.config` is not its family's section fails construction). There is **NO check that every family command is mounted, or every mounted command belongs to a family**.
- **No family-map-vs-mount-map coverage test exists yet.** `v8-bin.test.ts:235-237` only asserts `expect(() => buildCli()).not.toThrow()` plus --help/--version through the real tree. A coverage test could be written from exported values: iterate `commandFamilies[i].commands` values and assert each appears in `Object.values(spec.commands)` (and vice versa) — but `buildCli` currently returns the constructed `Cli`, not the spec, so the test would either need the spec exported separately or reconstruct the same records.

---

## 6. Credentials / managementApi wiring and ctx.api

**Bin side** (packages/cli/src/v8/runtime.ts:41-76 `assembleRuntime(proc: HostProcess)`): builds `Runtime` with `getCredentials: makeGetCredentials(proc.env)` and `managementApi: { baseUrl: getApiBaseUrl(proc.env) }`, both from `../auth`. `makeGetCredentials` behavior (pinned in v8-bin.test.ts:140-163): non-empty `PRISMA_SERVICE_TOKEN` wins (trimmed); blank-but-set token **throws** ("PRISMA_SERVICE_TOKEN is set but empty") rather than falling back; otherwise stored tokens. `getApiBaseUrl` default `https://api.prisma.io`, overridden by `PRISMA_MANAGEMENT_API_URL`. Also `detectPackageManager(env)` from `npm_config_user_agent`, `makeOnSignal(proc)`, `config: await loadConfig(proc.cwd())`.

**main.ts** (packages/cli/src/v8/main.ts): `main(proc, buildCliForRun = buildCli)` — construction error → one stderr line, return 1; `maybeWriteCachedUpdateNotification` before dispatch; `assembleRuntime`; `resolveTelemetryHooks(proc)` (returns `CliRunHooks | undefined`, `{ onSettled }` spawning the detached sender; any throw → hooks undefined); `cli.run(proc.argv.slice(2), runtime, hooks)`.

**Engine side** — ctx.api (execution/command-context.ts:90-96): lazy getter, once per run:
```ts
get api(): ManagementApiClient {
  api ??= invocation.hooks.managementApi?.client ?? buildManagementApiClient(invocation);
  return api;
}
```
`buildManagementApiClient` (execution/api-client.ts:28-60): returns a Proxy; the SDK module is dynamically imported only on first actual method call. `constructClient` calls `createSdk({ clientId: "", redirectUri: "", tokenStorage: { getTokens: async () => { const credentials = await invocation.runtime.getCredentials(); if (credentials === undefined) throw credentialsRequiredError(); return { workspaceId: "", accessToken: credentials.token }; }, setTokens: async () => {}, clearTokens: async () => {} }, apiBaseUrl: invocation.runtime.managementApi.baseUrl })` — token read **per request**, so mid-run refresh is picked up. `restoreStructuredThrow` unwraps the SDK's FetchError cause chain: a `CliStructuredError` in the chain is rethrown as itself; an SDK `AuthError` (matched by `name === "AuthError"`, never instanceof) maps to `credentialsRequiredError()`.

`CLI.CREDENTIALS_REQUIRED` verbatim (execution/needs.ts:141-151): code `"CLI.CREDENTIALS_REQUIRED"`, summary `"You must be signed in to run this command."`, nextActions `[{ kind: "user-choice", label: "Sign in, then run the command again." }]`. Byte rendering (pinned): `✖ [CLI.CREDENTIALS_REQUIRED] You must be signed in to run this command.\n→ Sign in, then run the command again.\n`, exit 2.

---

## 7. CLI_NAME / cli-name.ts

packages/cli/src/cli-name.ts:
```ts
export const CLI_NAME = "prisma-cli";
export const CLI_DOCS_URL = "https://www.prisma.io/docs/orm/tools/prisma-cli";
```
Every nextAction `command` string is template-built from it: `` `${CLI_NAME} auth login` ``, `` `${CLI_NAME} auth whoami` ``, `` `${CLI_NAME} project list` ``, `` `${CLI_NAME} auth workspace list` ``, `` `${CLI_NAME} auth workspace use <id>` `` (placeholder args in angle brackets). Prose inside `why`/`label` also interpolates it (e.g. `` `Run ${CLI_NAME} auth login and authorize a workspace.` ``, `` `Pass a workspace from ${CLI_NAME} auth workspace list.` ``). Note: the engine's `{bin}` substitution applies only to help examples; nextActions use CLI_NAME directly.

---

## 8. Legacy CliError (packages/cli/src/shell/errors.ts)

```ts
export type ErrorDomain = "cli" | "auth" | "project" | "branch" | "app" | "database" | "bucket";

export interface CliErrorOptions {
  code: string; domain: ErrorDomain; summary: string;
  why: string | null; fix: string | null;
  debug?: string | null; where?: string | null;
  meta?: Record<string, unknown>; docsUrl?: string | null;
  exitCode?: number;                 // default 1
  nextSteps?: string[]; nextActions?: NextAction[];   // NextAction from src/shell/next-actions
  humanLines?: string[];
}
export class CliError extends Error { /* all of the above as readonly fields; severity: "error"; name "CliError" */ }
```
Constructors in the file: `usageError(summary, why, fix, nextSteps?, domain?)` (code `USAGE_ERROR`, exit 2), `authRequiredError`, `authConfigInvalidError`, `commandCanceledError` (exit 130), `workspaceRequiredError`, `featureUnavailableError`; auth-specific ones re-exported from `src/auth/errors.ts` (`workspaceAmbiguousError`, `workspaceNotAuthenticatedError`, `workspaceSwitchUnavailableError`).

The only existing v8 mapping helper is `mapAuthOperationError` in `packages/cli/src/v8/auth/errors.ts` (§1) — per-family map table, not generic. Fields dropped in mapping: `domain` (folded into the dotted namespace), `debug`, `where` (legacy is a string; structured `where` is `{path?,line?}`), `exitCode`, `nextSteps`, `nextActions`, `humanLines`. Legacy `fix` → one `user-choice` nextAction.

---

## 9. Legacy fixture-test files for project/database/bucket/branch/git (packages/cli/tests/)

Resource-command test files and whether they reference `fixturePath` (helpers.ts:51,75,100,130 defines it in the test-shell builders):

| File | fixturePath? |
|---|---|
| project.test.ts | yes |
| project-mutations.test.ts | yes |
| project-controller.test.ts | yes |
| project-real-mode.test.ts | no |
| project-resolution.test.ts | no |
| project-usecases.test.ts | no |
| database.test.ts | yes |
| database-plan-limit.test.ts | no |
| bucket.test.ts | yes |
| branch.test.ts | yes |
| branch-controller.test.ts | no |
| branch-usecases.test.ts | no |
| local-branch.test.ts | no |
| read-branch.test.ts | no |
| app-branch-database.test.ts | no |
| git-adapter.test.ts | no (adapter unit tests, no fixtures) |

Other fixturePath users (not resource commands, for context): auth.test.ts, auth-controller.test.ts, app.test.ts, init.test.ts, shell.test.ts, update-check.test.ts, version.test.ts, helpers.ts, use-case-helpers.ts. `auth-real-mode.test.ts` matches "fixture" prose but not `fixturePath`.

There is no dedicated `git.test.ts`; git-related coverage lives in `git-adapter.test.ts` (and branch tests).
