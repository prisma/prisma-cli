# PR #130 — system-design review (architect pass)

**Review range:** `origin/main...HEAD` (branch `s2a-foundations`, base `origin/main`). 184 files, roughly 18,000 added lines.

**Expectation sources, in the order they govern:**

1. `.drive/projects/prisma-cli-v8/specs/s2a-foundations.md` — the slice contract, including the two 2026-08-10 errata that record the credential-manager rework.
2. `.drive/projects/prisma-cli-v8/assets/engine/credential-manager-design.md` — revision 5, normative for the credential manager.
3. `.drive/projects/prisma-cli-v8/assets/engine/engine-interface-draft.ts` — normative engine interface commentary (§4b carries the manager surface).
4. `.drive/projects/prisma-cli-v8/assets/s2/parity-divergences.md` — the recorded behaviour differences from the legacy CLI.
5. `.drive/projects/prisma-cli-v8/specs/s2-overview.md` — standing rulings and the operator question ledger.
6. The pull request description (`gh pr view 130`).
7. `AGENTS.md`, `ARCHITECTURE.md`, `docs/architecture/package-structure.md`.
8. The diff.

**What this pass covers:** the shape of the system — which concepts were introduced, whether they live in the right package, whether the type system's partitions match the domain's, whether names carry their meaning, and whether the test seam is evidence of a clean partition. Implementation correctness, failure modes, blast radius, operability, cost, and test-assertion strength belong to the principal-engineer pass running in parallel and are not adjudicated here. Adopter learnability, scope and user value, and open-source surface stewardship are out of scope; where something is glaring I refer it in one line.

## 1. The problem being solved and the guarantees introduced

Today's CLI keeps a bag of per-workspace OAuth token pairs plus a sidecar file naming the active workspace, and it treats that bag as "credentials with a pointer at one of them". Reads re-fetch workspace names from the network, `auth logout --workspace` ends one entry, and orphaned entries accumulate because nothing owns the whole set. This branch replaces that with a model of **sessions**: at most one session per workspace, exactly one of them marked current, and one component — the credential manager — that owns the state file and is also what the platform SDK writes through on a 401 refresh.

The guarantees the change introduces, as I read them out of the code rather than the prose:

- **One owner of the state file.** `FileCredentialManager` is the only thing that reads or writes it in the v8 path, and the SDK's `TokenStorage` view is produced by that same object, so a refresh write and a login write go through the same rules.
- **A process's session does not move.** The session a run acts as is decided at the first read and pinned for the process's lifetime. This is the guarantee that makes a single memoised API client per run correct, and it is what allowed the design to delete the whole epoch/cache-invalidation/heartbeat apparatus that revisions 3 and 4 carried.
- **Reads never write and never touch the network.** Including the legacy-store adoption, which is a pure read; the file is only rewritten on the first mutation.
- **Dependency direction: the engine owns the API client and the command context; the CLI package owns the manager implementation.** The engine declares the `CredentialManager` interface and consumes it; the CLI implements it and the bin injects it.

That last point is the boundary question the brief asks about, and I think it is drawn correctly. The engine defines the contract at the layer that consumes it, the concrete implementation lives with the thing that knows about Prisma's auth files, and the bin does the wiring. Nothing in the engine reads `process.env` or the filesystem for auth; nothing in the manager talks to the user or opens a browser. The one place the engine reaches past the abstraction — reading `PRISMA_SERVICE_TOKEN` from `Runtime.env` to build the static-token client rather than asking the manager for token material — is a deliberate, recorded trade (design §4/§6) and I agree with it: handing token material back out of the manager to satisfy one construction path would be worse than letting the engine read one environment variable. Finding D09 is about the *duplication* that choice produced, not about the choice.

The deletion of the concurrency machinery is the strongest thing in this change. Design §10's "Made MOOT by process pinning" list is exactly the kind of disposition record that keeps a design honest, and the code matches it: there is no epoch, no client cache with keys, no lock re-entrancy, no heartbeat. `withRefreshLock` really is in-process single-flight (`packages/cli/src/auth/credential-manager.ts` lines 322-329) and the file lock really is short (`packages/cli/src/auth/state-file.ts` lines 217-231). I looked for residue of the deleted model in names and types and found none — the vocabulary problems below are about the *new* model, not leftovers from the old one.

I also checked the other engine additions this slice makes (`ctx.openUrl` / `prompt.browserWait`, the repeatable `--confirm` flag, `RunHooks.onSettled`) for architect-class problems. The `openUrl` / `browserWait` split across the context and the prompt surface is defensible — one is output, one is input — and I have no finding on it. `--confirm` reads cold and pairs correctly with the consent token concept. The one naming problem in that group is D12.

## 2. Subsystem fit and boundary correctness

**Engine → CLI direction is right.** `packages/cli-engine/src/credential-manager.ts` declares interfaces only; `packages/cli-engine/src/execution/api-client.ts` consumes them; `packages/cli/src/auth/credential-manager.ts` implements them. This is the repo's "SPI at the lowest consuming layer" shape and the change follows it cleanly.

**The engine does know one thing it arguably should not**, and it is not the environment variable — it is the JWT. `packages/cli-engine/src/testing-credential-manager.ts` lines 45-77 implement base64url JWT decoding, a `workspace_id` claim reader, an `exp` reader, and a JWT minter that the package exports publicly as `mintTestJwt`. The engine's own `Session` type is deliberately claim-free and token-free; the design put claim decoding on the manager side. Shipping the token format in the engine's public testing surface undoes part of that separation, and it is the mechanism behind D04's concrete divergence. This is the clearest boundary smell in the change, though its practical cost today is confined to tests.

**Two auth models coexist in `packages/cli/src/auth/`,** which is expected during the staged swap but is presented as one flat public face (D18). The new session model's only structural dependency on the legacy stack is `getAuthContextFilePath`, imported from the 781-line legacy `token-storage.ts` by both `credential-manager.ts` and `legacy-state.ts` (D17).

**The repo's own architecture catalogue no longer describes the repo** (D16). `ARCHITECTURE.md` names `docs/architecture/package-structure.md` canonical; that file still says the repository contains two publishable packages and describes only the legacy `src/commands|controllers|use-cases|adapters` layout. This branch adds `packages/cli-engine` and `packages/cli-telemetry` and a new `src/auth/` + `src/v8/` layout, and touches `docs/README.md` and an ADR, so docs were in scope for the change.

## 3. Naming and typology integrity

Each probe and what it caught.

**Discriminator-completeness.** Three qualifier-style prefixes fire. `EngineCommandSnapshot` distinguishes itself from a Commander snapshot that does not exist in this repository — the contract's own wording ("Replace the Commander snapshot type with the engine shape") admits the contrast is historical (D12). `FileCredentialManager` versus `TestCredentialManager` is a mixed pair: `File*` is a concrete, structural, stable contrast (the backing store) and passes; `Test*` names the consumer and fails (D15). The `CLI.*` / `AUTH.*` error namespaces are the serious case: the prefix creates an implied taxonomy and the codes do not partition along it (D05).

**Consumer-versus-essence.** `TestCredentialManager` is named for who uses it, not what it is; its essence is "in memory" (D15). `EngineCommandSnapshot` is the mirror image — named for the layer that produces it (D12). `tokenStorage()` is documented as "engine-facing" on an interface every `managesCredentials` command receives in full, so the audience distinction lives in a comment rather than in the types (D08).

**Concept-versus-mechanism.** `Session`, `Credential`, `currentSession`, `endSession` are all domain concepts and read as such — this is the part of the vocabulary the design got right, and the PR description's example output shows it reads well to a user. The mechanism leaking into the concept layer is `environmentSessionInForce`, a function named as a predicate that raises a structured error on a blank token, imported by two commands to re-derive something the engine already resolved (D10).

**Symmetry.** `createSession` ↔ `endSession` reads as a pair. Three asymmetries do not: the marker is read with `currentSession()` and written with `useSession()`, against the design's own rule that the marker is called current everywhere (D13); `createSession` returns what it made while `endAllSessions` returns nothing and makes every caller reconstruct it (D14); and five operations take a `Session` or nothing while `tokenStorage()` takes a bare `workspaceId` (folded into D08).

**Reads cold.** Hand `CredentialManager` to a contributor with no project knowledge and they expect `getCredential` / `setCredential`; what they get is six session operations (D03). Hand them `Session.current` and they expect "this is the session I am using"; under `PRISMA_SERVICE_TOKEN` the row marked `current` in `auth workspace list` is explicitly not the session in force (D02). Hand them `Session` and they expect `workspaceId` to identify the session; an environment session can carry `""` (D01).

## 4. The design documents

`credential-manager-design.md` rev 5 is a good document. It grounds every rule in verified upstream behaviour (§1 cites the control-plane source for the refresh-token reuse grace, which is what licenses the whole "no client-side coordination" decision), it states its slices as a table (§8), and §10 separates what the delta review changed from what the pinning ruling made moot. The code matches it closely — I checked the migration table (§7) against `legacy-state.ts` and the write slices (§8) against `credential-manager.ts`, and both agree.

Three gaps in its reasoning, all recorded as findings below rather than as separate document findings: it states "the marker is called CURRENT everywhere" in §2 and then names the writer `useSession` in §3 without reconciling the two (D13); it justifies putting `tokenStorage()` on the user-facing interface with a safety argument ("it exposes a capability the SDK consumes, never token material to engine code") and never answers the cohesion question the deviation actually raises (D08); and it asserts "error single-sourcing" for the blank-service-token rule when what is single-sourced is the error *constructor*, not the detection (D09).

One structural note on the document itself: §9 is a PR-scoped work plan ("Change surface on PR #130") living inside a document marked normative for the design. Once #130 lands, §9 is history and the rest is still binding. Worth splitting when the next revision happens; I have not filed it as a finding because it costs nothing today.

`s2a-foundations.md`'s two errata are the right way to handle a contract that was reviewed before the rework landed — they name what changed and mark the reviewed text as superseded rather than silently rewriting it.

## 5. Test strategy at the architectural level

The seam is in the right place: commands are tested through `createTestCli` against an in-memory `CredentialManager`, which is the same interface production commands see, and the harness reads the whole stored state back. That is a clean conceptual partition — it proves commands depend on the session *contract* and nothing below it.

What the seam does not have is any assertion that the two implementations of that contract agree. `TestCredentialManager` in the engine and `FileCredentialManager` in the CLI are each around three hundred lines, and both implement pinning, the env-override refusal rules, upsert-by-workspace, marker semantics, and the four `TokenStorage` write slices. Their test files even mirror each other's `describe` names — "process pinning", "mutations under an env(ironment) session" — which tells me the team already knows the two must agree. Nothing proves it, and they have already drifted in at least four places (D04). This is the one place where the test surface is compensating for a partition that is not clean rather than demonstrating one that is.

The cross-process suite (`packages/cli/tests/credential-manager-processes.test.ts` with its worker helper) is the right shape for the properties that only exist across processes, and the filesystem-spy and leak-scan suites prove properties that are architectural claims rather than behaviours ("reads never write", "token material never leaves"). Those are good.

## Findings

Ordered by importance.

### D01 — `Session` is one type covering two structurally different things

**Location:** `packages/cli-engine/src/credential-manager.ts` lines 20-26; `packages/cli/src/auth/credential-manager.ts` lines 351-363; `packages/cli-engine/src/testing-credential-manager.ts` lines 305-325.

**Problem.** `source: "stored" | "environment"` is a discriminator that the type does not use as one. A stored session is keyed by a workspace, carries a name, and may or may not be the marked one. An environment session is keyed by nothing (the manager writes `workspaceId: serviceTokenWorkspaceId(token) ?? ""`), never has a name, never appears in `sessions()`, and is always `current: true`. Three of the five fields mean something different or nothing at all depending on which variant you hold, and the type says they are all always present and all `string`/`boolean`. The empty-string workspace id is the symptom: in a model whose central rule is "sessions are keyed by workspace id", the type permits a session with no key. It also reaches the user — `sessionLabel()` falls back to `workspaceId`, so a service token whose workspace cannot be derived renders an empty workspace row in `whoami`.

**Why it matters.** Every downstream command family in S2b/S2c will consume `Session`. A type whose fields silently change meaning by variant is the kind of thing each new consumer rediscovers by writing a bug.

**Proposed alternative.** Make `source` a real discriminator:

```ts
export type Session =
  | { readonly source: "stored"; readonly workspaceId: string; readonly workspaceName: string | undefined; readonly expiresAt: Date | undefined; readonly current: boolean }
  | { readonly source: "environment"; readonly workspaceId: string | undefined; readonly expiresAt: Date | undefined };
```

Every site that reads `workspaceId` unconditionally then has to say what it means for the environment case, which is exactly the decision that is currently being made by `?? ""`.

### D02 — `current` means two different things depending on which accessor produced the session

**Location:** `packages/cli-engine/src/credential-manager.ts` line 25; `packages/cli/src/auth/credential-manager.ts` lines 356-362 and 463-472; `packages/cli/src/v8/auth/workspace-list.ts` lines 41-78.

**Problem.** In `sessions()`, `current` means "named by the file's `currentWorkspaceId` marker". In `currentSession()` under an environment override, the manager synthesises `current: true` for a session that is not the marker at all — it means "this is the session in force for this process". Under `PRISMA_SERVICE_TOKEN`, `auth workspace list` therefore prints a row marked `current` that is not the session any command will use, and the command compensates with a prose notice and a separate JSON field, `environmentSessionInForce`. The model has two concepts — "the file's marker" and "the session in force for this process" — and one word plus an ad-hoc phrase for them. "In force" appears only in a CLI helper name and in prose; it is not a concept the types know about.

**Why it matters.** This is the vocabulary a user reads in `list` output and an agent parses out of the JSON. Two meanings on one field is the classic homonym, and the question will be reopened in every command that displays a session.

**Proposed alternative.** Let `current` mean exactly one thing — "this session is the one the file's marker names" — and stop synthesising it: the environment session's `current` becomes `false` (it is not the marker), and "which session is in force" is expressed by the fact that `currentSession()` returned it. If the type is split per D01, the environment variant simply has no `current` field, which makes the question unaskable.

### D03 — The manager is named for credentials; everything it does is sessions

**Location:** `packages/cli-engine/src/credential-manager.ts` lines 36-86; `packages/cli-engine/src/context.ts` line 7; `packages/cli/src/auth/state-file.ts` lines 26-36 and 98-137.

**Problem.** Of the seven members of `CredentialManager`, six name sessions and the word "credential" appears in exactly one argument position. The state file's type is `CredentialState` and its reader is `readCredentialState`, though the thing it holds is `sessions` plus a marker. The design's §2 says plainly "The domain: a set of per-workspace sessions, one current" — and then names the owner of that domain after the thing it stores rather than the thing it models. Compounding it, the engine exports both `Credential` (the new proof material) and `Credentials` (the legacy `{ token: string }` shape) from the same index; two types one letter apart with unrelated meanings.

**Why it matters.** `@prisma/cli-engine` is being published at `8.0.0-rc.1` in this same change and every S2b/S2c command family will import this name. The cost of the rename is at its lowest right now and rises monotonically from here. The persona's rule applies: a rename is the architecture's surface, not cosmetics.

**Proposed alternative.** `SessionStore` for the interface (`Runtime.sessionStore`, `ctx.sessionStore`), `SessionState` / `readSessionState` for the file, `FileSessionStore` / in-memory sibling for the implementations. Keep `Credential` for the proof material — that name is correct. Rename `Credentials` to `LegacyCredentials` in the same pass so the two cannot be confused for the remainder of the staged swap, or delete it if D19 is taken. The error codes are a separate question (D05); they can keep the word "credentials" if the family rule says so.

### D04 — Two full implementations of the session model, with nothing asserting they agree

**Location:** `packages/cli-engine/src/testing-credential-manager.ts` lines 92-393; `packages/cli/src/auth/credential-manager.ts` lines 77-404; `packages/cli-engine/tests/credential-manager.test.ts`; `packages/cli/tests/credential-manager.test.ts`.

**Problem.** The harness's manager is not a stub — it reimplements pinning, the env-override refusals, upsert-by-workspace, marker clearing, and all four `TokenStorage` write slices. The whole test strategy rests on it behaving like production. It already does not, in at least four places I found by reading:

- Environment-session workspace derivation: production uses `serviceTokenWorkspaceId`, which falls back to a `sub: "workspace:<id>"` claim (`packages/cli/src/auth/claims.ts` lines 32-42); the harness uses `claimedWorkspaceId` only and *throws a harness error* if `workspace_id` is absent. A service token that works in production cannot be seeded into a test.
- Claim/argument mismatch in `createSession`: production raises the structured `AUTH.CREDENTIAL_WORKSPACE_MISMATCH`; the harness throws a plain `Error`. Same for the `setTokens` re-scope refusal.
- Blank environment token: production raises `AUTH.SERVICE_TOKEN_EMPTY` from `createSession` and from every read; the harness cannot represent the condition at all.
- `CLI.CREDENTIALS_UNREADABLE` and `CLI.CREDENTIALS_LOCKED` exist only in production.

**Why it matters.** Every command test in S2a, S2b and S2c is written against the harness. Where the two disagree, the tests assert behaviour the product does not have. The parallel `describe` names in the two test files show the team is already maintaining the agreement by hand.

**Proposed alternative.** Export one conformance suite from the engine's testing subpath — a function that takes a factory for a `CredentialManager` plus a way to seed state, and asserts the contract's rules — and run it in both packages: against `TestCredentialManager` in the engine and against `FileCredentialManager` over a temp directory in the CLI. That is the cheapest fix and it turns the contract into something executable. The deeper fix, if the duplication grows further, is to extract the pure state rules (pin resolution, upsert, marker clearing, slice application) into one module both managers apply, leaving each with only its own persistence.

### D05 — The `CLI.*` / `AUTH.*` error namespaces do not partition on any stable line

**Location:** `packages/cli-engine/src/protocol.ts` lines 47-50 (the rule); `packages/cli-engine/src/credential-errors.ts` (whole file); `packages/cli/src/v8/auth/session-ref.ts` lines 39-58; `packages/cli/src/v8/auth/workspace-use.ts` lines 18-32; `packages/cli/src/v8/auth/login.ts` lines 31-46; `packages/cli/src/auth/credential-manager.ts` lines 52-69.

**Problem.** `protocol.ts` says "the namespace prefix is the error's category". Applied to this diff, the categories do not hold. `CLI.CREDENTIALS_REQUIRED`, `CLI.CREDENTIALS_UNREADABLE`, `CLI.CREDENTIALS_LOCKED` and `CLI.AUTH_SERVICE_ERROR` are all auth-domain failures sitting in the `CLI` namespace — the last one carries the other namespace's word inside its own subcode. Meanwhile `AUTH.SERVICE_TOKEN_EMPTY` is raised by the engine's needs check, `ctx.session()` and the request path, exactly like `CLI.CREDENTIALS_REQUIRED` is, so "who raises it" is not the line either. And the `AUTH.*` constructors are scattered across four files in two packages with no single place that enumerates the family — the engine owns three of them, the v8 command tree owns three, and the CLI's manager owns one.

**Why it matters.** These codes are a public contract; the PR description leads with one (`AUTH.NO_SESSION_FOR_WORKSPACE`) and the divergence record documents the full mapping for agents to consume. A namespace whose membership rule cannot be stated will be guessed at by every future command family, and the guesses will differ.

**Proposed alternative.** State the rule in `protocol.ts` — I would use "the namespace names the subsystem that owns the failure, not the layer that raises it" — then move the four auth-domain `CLI.*` codes into `AUTH.*` and put every `AUTH.*` constructor in one module. Since the manager contract is the engine's, `packages/cli-engine/src/credential-errors.ts` is the natural home; the v8 command tree imports from it rather than declaring its own. If moving the `CLI.CREDENTIALS_*` codes is judged too disruptive for consumers, say so explicitly in the doc comment and record the exception — an acknowledged exception is cheaper than an unstated rule.

### D06 — The engine hardcodes a binary name, and the product now emits three different ones

**Location:** `packages/cli-engine/src/credential-errors.ts` lines 8-12 and 143-159; `packages/cli/src/cli-name.ts` line 7; `packages/cli/src/v8/cli.ts` line 16.

**Problem.** The engine's `nextAction`s say `prisma auth login` and `prisma auth workspace use`. The CLI package's commands say `${CLI_NAME} auth login`, where `CLI_NAME` is `"prisma-cli"`. The engine's own `createCli({ name })` is passed `"prisma-v8"`. One run can therefore print two different invocations of the same command depending on which layer produced the remediation. Structurally the problem is that the engine — a package explicitly designed so the bin injects everything environmental — hardcodes a fact only the bin knows.

**Why it matters.** `nextAction.command` is meant to be copy-pasteable and is what an agent executes. It is also the most visible piece of vocabulary the CLI has.

**Proposed alternative.** The engine already receives the name (`createCli({ name })`, threaded into `Invocation` at `execution/engine.ts:266`). Phrase engine-side remediation commands from it, and have the CLI's `CLI_NAME` be the value it passes to `createCli` so there is one source. Whether the shipped name is `prisma` or `prisma-cli` is a product question, not mine — the finding is that it must be one value in one place.

### D07 — `Runtime.managementApi` is required and read by nothing

**Location:** `packages/cli-engine/src/runtime.ts` line 72; `packages/cli/src/v8/runtime.ts` line 109; `packages/cli-engine/src/testing.ts` lines 216-218.

**Problem.** `ManagementApiClientConfig.apiBaseUrl` (added by design rev 5) carries the same value and is the one the engine actually reads (`execution/api-client.ts:111`). Nothing in the engine reads `Runtime.managementApi`. It is a required member of the public `Runtime` type, so every bin and every future harness has to supply a field that does nothing.

**Why it matters.** Small, but it is a public type in a package about to be published, and it is exactly the residue the s2a contract's §2 shape left behind when rev 5 superseded it. Two carriers of one value invite them to disagree.

**Proposed alternative.** Delete `Runtime.managementApi`; keep `createTestCli`'s `managementApi: { baseUrl?, client? }` seed as the harness's convenience (it already feeds `apiBaseUrl`).

### D08 — `tokenStorage()` puts two audiences on one interface, and takes a different kind of reference from every other member

**Location:** `packages/cli-engine/src/credential-manager.ts` lines 80-85; `packages/cli-engine/src/execution/command-context.ts` lines 120-133; design `credential-manager-design.md` §3 and §10 ("VETO-ABLE deviation 2").

**Problem.** The design flagged this itself and justified it on safety grounds — the view exposes a capability, not token material. I agree with the safety argument and with keeping the view on the manager: the manager is the single owner of the file, so the SDK's write path has to come from it. What the justification does not address is cohesion. The comment says "ENGINE-FACING, not a user operation", but `ctx.credentialManager` hands the whole interface to the five `managesCredentials` commands, so nothing stops a command from calling it — the audience distinction lives in prose. Separately, `tokenStorage(workspaceId: string)` is the only member that takes a bare id; `useSession` and `endSession` take a `Session` and read only its `workspaceId`, and the engine only ever calls `tokenStorage` with the pinned session's id.

**Why it matters.** An interface-segregation violation that is enforced by a comment is enforced by nothing, and this particular one guards the path that writes token material.

**Proposed alternative.** Split the type and let the structure say what the comment says:

```ts
export interface SessionStore { /* the six session operations */ }
export interface SessionTokenCustody { tokenStorage(session: Session): TokenStorage }
```

`Runtime.credentialManager` is typed `SessionStore & SessionTokenCustody`; `ctx.credentialManager` is typed `SessionStore` only. One implementation still satisfies both, the engine still gets its view, and a command physically cannot reach token custody. Taking a `Session` also brings the member into line with its siblings.

### D09 — The blank-service-token rule is implemented on both sides of the package boundary

**Location:** `packages/cli-engine/src/execution/api-client.ts` lines 13 and 117-128; `packages/cli/src/auth/service-token.ts` lines 10-19; `packages/cli-engine/src/testing-credential-manager.ts` line 14; `packages/cli/src/auth/client.ts` line 7.

**Problem.** Design §3 says the blank/whitespace service token produces "one structured error raised identically from `currentSession()`, the needs check, and the engine's request path". The error *constructor* is indeed single-sourced in the engine. The *rule* — read the variable, trim, treat empty as an error — is written twice in surviving code (the engine's client construction and the CLI's `environmentServiceToken`), and the variable name `"PRISMA_SERVICE_TOKEN"` is a string literal in three source files across two packages. Two more copies exist in legacy code that S2d deletes (`auth/credentials.ts`, `auth/guard.ts`), each with its own error type — including a legacy `EmptyServiceTokenError` class exported from the same `auth/index.ts` as the new constructor.

**Why it matters.** The design's claim of single-sourcing is what justifies not testing the rule at each call site. Two implementations can drift — for instance if trimming semantics or the accepted spellings change — and the drift will show up as one command accepting a token another rejects.

**Proposed alternative.** Give the manager one member that answers the question the engine is asking ("is an environment session in force, and what is its bearer?") and have `api-client.ts` call it instead of re-reading the variable, or, if the design's rule that the manager never hands out token material is to hold absolutely, have the engine import the variable name and the blank check from a single shared constant module. Either way `PRISMA_SERVICE_TOKEN` should appear once.

### D10 — Commands re-derive the environment override from `ctx.env`, through a predicate that throws

**Location:** `packages/cli/src/auth/service-token.ts` lines 21-26; `packages/cli/src/v8/auth/workspace-list.ts` lines 8 and 89; `packages/cli/src/v8/auth/login.ts` lines 13 and 120.

**Problem.** `environmentSessionInForce(env)` reads as a total predicate and is not one: on a blank token it raises `AUTH.SERVICE_TOKEN_EMPTY`. Two commands call it to compute a boolean the engine has already decided — the manager pinned the session and knows its `source`. So the override decision is made in two places, and `auth workspace list` can fail from inside what looks like a display flag.

**Why it matters.** It re-opens the boundary the manager was created to close: the manager is supposed to be the only thing that decides what the environment variable means.

**Proposed alternative.** Derive it from the session the engine already resolved — `(await ctx.session())?.source === "environment"` — which is one call the commands are already entitled to make. If a boolean helper survives for the legacy shell, make it total and name it for what it does.

### D11 — The harness's session record does not mirror the record it claims to mirror

**Location:** `packages/cli-engine/src/testing-credential-manager.ts` lines 16-22; `packages/cli/src/auth/state-file.ts` lines 18-24.

**Problem.** `TestSessionRecord` is documented as "mirroring the state file's records". The state file's record is `{ workspaceId, name?, token, refreshToken?, expiresAt? }`; the harness's is `{ workspaceId, workspaceName, credential: { token, refreshToken, expiresAt } }`. Same concept, different field name for the workspace name (`name` versus `workspaceName`) and different nesting. `Session.workspaceName` versus `StoredSession.name` is the same drift showing up in the public type.

**Why it matters.** A test author reading either shape will assume the other matches. It is also the smaller half of D04 — two spellings of one record makes the two implementations harder to keep in step.

**Proposed alternative.** One record shape, named once. `workspaceName` everywhere (it matches `Session`), and either flatten the harness's credential fields or nest the file's — the nesting choice matters less than picking one.

### D12 — `EngineCommandSnapshot` names a contrast that does not exist, and is declared twice

**Location:** `packages/cli-engine/src/run-summary.ts` lines 8-27; `packages/cli-telemetry/src/sanitize.ts` lines 1-40.

**Problem.** The `Engine*` prefix distinguishes the type from the Commander-shaped snapshot it replaced, which does not exist in this repository — the contract's own phrasing ("Replace the Commander snapshot type with the engine shape") shows the contrast is historical. The prefix also names the producer rather than the thing. Separately, the type is declared structurally twice, deliberately, so `@repo/cli-telemetry` carries no engine dependency; the two are kept compatible by nothing but a comment in each file.

**Why it matters.** Small on its own. It matters because it is a name in the engine's published surface, and because the two declarations will be edited independently the first time a field is added.

**Proposed alternative.** `CommandSnapshot`. Keep the structural duplication if the no-dependency rule is worth it — it is a reasonable trade for a bundled telemetry package — but add a compile-time compatibility check in the telemetry package's type tests (a dev-only `satisfies` against the engine's type) so a divergence fails a build rather than a wire format.

### D13 — The writer of the current marker is the only member not named for "current"

**Location:** `packages/cli-engine/src/credential-manager.ts` lines 62-68; design `credential-manager-design.md` §2 ("The marker is called CURRENT everywhere").

**Problem.** The design pins the vocabulary: state field `currentWorkspaceId`, list flag `current`, read `currentSession()`. The mutator that sets it is `useSession()`. The design's own sentence lists the field, the flag and the read, and quietly omits the writer.

**Why it matters.** It is the one place where the command name (`auth workspace use`) has leaked into the domain model. `useSession` also reads cold as "consume this session for something", which is not what it does.

**Proposed alternative.** `makeCurrent(session)` or `setCurrentSession(session)`. The user-facing command stays `auth workspace use`; a command name and an SPI member name do not have to match, and here they should not.

### D14 — `endAllSessions` refuses to say what it ended

**Location:** `packages/cli-engine/src/credential-manager.ts` lines 77-78; `packages/cli/src/v8/auth/logout.ts` lines 43-50.

**Problem.** The design specifies `Promise<void>` and instructs the command to call `sessions()` beforehand to get the count. `createSession` returns the session it made and `useSession` returns the session it selected, so the asymmetry is deliberate but unexplained. Every caller that wants to report the outcome — which is every caller, since the divergence record makes the count a user-visible behaviour — has to reconstruct it from a separate read.

**Why it matters.** An operation that knows the answer and makes the caller re-derive it is a shape every future caller will copy.

**Proposed alternative.** `endAllSessions(): Promise<readonly Session[]>` returning what was ended. The command reports `result.length` and drops its preparatory read.

### D15 — `TestCredentialManager` is named for its consumer

**Location:** `packages/cli-engine/src/testing-credential-manager.ts` line 92; `packages/cli-engine/src/exports/testing.ts` lines 6-12.

**Problem.** The essence is "in memory"; "test" is who uses it, and the `./testing` subpath already says that. The file also sits at the package root as `testing-credential-manager.ts` beside `testing.ts`, where the package's other groupings are directories (`execution/`, `exports/`).

**Why it matters.** Low on its own, but it is exported publicly, and if D04's conformance suite lands, the in-memory manager becomes a legitimate reference implementation rather than a test-only artefact — at which point the name is actively wrong.

**Proposed alternative.** `InMemoryCredentialManager` (or `InMemorySessionStore` if D03 is taken), in `testing/` alongside the harness.

### D16 — The repo's canonical architecture doc no longer describes the repo

**Location:** `docs/architecture/package-structure.md` lines 1-22; `ARCHITECTURE.md` lines 6-10.

**Problem.** `ARCHITECTURE.md` names `docs/architecture/package-structure.md` canonical. That file states the repository contains two publishable packages (`cli`, `compute`) and documents only the legacy `src/commands|controllers|use-cases|adapters|lib|shell` layout with layering rules written for it. This branch adds `packages/cli-engine` (published) and `packages/cli-telemetry` (private, bundled), plus the `src/auth/` module and the `src/v8/` command tree, and it touches `docs/README.md` and ADR 0001, so documentation was in scope.

**Why it matters.** The architecture catalogue is what a reviewer checks a change against. A stale catalogue means the next change has nothing to be checked against, and the S2b/S2c authors working in parallel worktrees have no written statement of the layering they are supposed to follow.

**Proposed alternative.** Add the two packages and the two new source trees to `package-structure.md`, and state the one layering rule this change establishes: the engine declares contracts and owns execution; command families implement commands against them; the CLI package owns Prisma-specific adapters (auth, state files) and the bin does the wiring. `docs/architecture/cli-engine-requirements.md` already exists and can be cross-referenced rather than duplicated.

### D17 — The surviving session model imports a path helper from the legacy storage file

**Location:** `packages/cli/src/auth/credential-manager.ts` line 32; `packages/cli/src/auth/legacy-state.ts` line 4; `packages/cli/src/auth/token-storage.ts` (781 lines, legacy).

**Problem.** `getAuthContextFilePath` is the only thing the new model needs from the legacy stack — `legacy-state.ts` needs it to read the sidecar during adoption and `credential-manager.ts` needs it to reap the sidecar in `endAllSessions`. It lives in the 781-line legacy `FileTokenStorage` module, so the surviving code imports from the file S2d is supposed to delete outright.

**Why it matters.** It turns a one-line deletion at S2d into a dependency untangle, and it points the new model's imports at legacy code for no reason.

**Proposed alternative.** Move `getAuthContextFilePath` into `legacy-state.ts` (or a small `legacy-paths.ts`), so the entire surviving dependency on the legacy world is the migration reader, and deleting `token-storage.ts` at S2d touches nothing else.

### D18 — `auth/index.ts` presents two auth models as one flat face

**Location:** `packages/cli/src/auth/index.ts` lines 1-53.

**Problem.** The module's single public face now exports the session model (`FileCredentialManager`, `resolveStateFilePath`, `claimedWorkspaceId`, `fetchWorkspaceName`) alongside the legacy model (`readAuthState`, `performLogout`, `storeLegacyCredential`, `FileTokenStorage`, `listAuthWorkspaces`, `switchAuthWorkspace`, `logoutAuthWorkspace`, `WorkspaceSelectionError`, `makeGetCredentials`, `EmptyServiceTokenError`) with nothing distinguishing them. The s2a contract's erratum acknowledges the growth but does not separate the two. `auth/errors.ts` does the right thing — its header names itself an S2d survivor — and that discipline has not been applied to the index.

**Why it matters.** A new consumer picking symbols off this face has no way to know which half is being deleted. The S2b and S2c authors are working against this module in parallel right now.

**Proposed alternative.** Two comment-delimited blocks in the index — "the session model" and "legacy shell only; deleted with the commander shell in S2d" — or, better, a `./legacy` subpath the legacy shell imports and nothing else does.

### D19 — Optional wiring models a migration phase in the type, and one absence is reported as a user error

**Location:** `packages/cli-engine/src/runtime.ts` lines 50-62; `packages/cli-engine/src/execution/api-client.ts` lines 103-116.

**Problem.** `credentialManager` and `managementApiClientConfig` are optional on `Runtime` "only during the staged swap", but the production runtime always supplies both and the harness always supplies the config. The optionality forces three call sites to handle a condition that cannot occur in a correctly wired bin, and they handle it inconsistently: a missing manager becomes `credentialsRequiredError()` — telling the user to sign in when the actual fault is a misconfigured bin — while a missing config eleven lines later throws a plain `Error` naming the wiring mistake. Meanwhile `getCredentials`, the fallback the optionality exists for, is reached in production by nothing and in tests by four call sites.

**Why it matters.** A required-in-practice dependency modelled as optional means every consumer invents its own answer to "what if it is missing", and here one of the answers misreports a wiring bug as an authentication problem.

**Proposed alternative.** Make `credentialManager` and `managementApiClientConfig` required now, and keep `getCredentials` as the single, clearly labelled staged-swap remnant with the harness's `credentials` seed selecting it. If the fallback runtime must remain expressible, model it as a union (`Runtime` with a manager, or a `LegacyRuntime` with `getCredentials`) rather than as three independent optional fields.

## Out of scope for this pull request

- **The legacy shell's parallel auth stack** — `auth/errors.ts`'s flat error codes, `auth/guard.ts`'s third client-construction path, `auth/operations.ts`, `auth/token-storage.ts`, `auth/workspaces.ts`, and the two additional copies of the blank-service-token rule they contain. All of it is deleted with the commander shell in S2d (s2-overview §S2d), and `auth/errors.ts` already labels itself as such. D17 and D18 are the parts I do consider in scope, because they change how cheaply that deletion happens.
- **`docs/architecture/overview.md`** — likely stale for the same reasons as D16, but the branch does not touch it and the ADR set is where the v8 decisions are being recorded. Worth a sweep when the package-structure doc is updated.
- **The telemetry package's internal shape** beyond the snapshot type (D12). It is a faithful port of an existing implementation and the contract asked for it unchanged; reviewing its internal names is a separate exercise from reviewing this change.
- **Release and versioning machinery** (`scripts/*version*`, the publish workflow, the `8.0.0-rc.1` lockstep). No architect-class concern found; it is a documented adoption of prisma/prisma's model.
- **The design document's §9** ("Change surface on PR #130") living inside a normative design. It becomes history the moment this merges; split it at the next revision.

## Referrals to other lenses

- **Principal-engineer.** The `Session.workspaceId` empty-string fallback (D01) is observable in `whoami` output, and `TestCredentialManager` diverging from production (D04) affects what the existing test suite actually proves. Both are worth a look from the correctness side, independently of the typology argument here.
- **Devrel.** The three binary names (D06) and the `current` / "in force" split (D02) are the two places where a fresh user will read the output and be wrong about what it means.
