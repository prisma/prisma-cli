# What the CLI invents on top of the API

An audit for the defect class PR #144 exposed: the CLI making a decision the API has already made, or supplying information the API did not give. Ranked by whether a user gets a confidently reported wrong answer rather than an error.

Branch audited: `s2b2-domain-extraction` at `39d6d50`. Trees read in full: `packages/cli/src/lib/**`, `packages/cli/src/controllers/**`, `packages/cli/src/v8/**`, plus `packages/cli/src/adapters/**` and `packages/cli/src/auth/**` where the resource commands read through them.

## The reference case, and where it now stands

PR #144 merged on 2026-08-11, and the workspace filter is gone from `main`. It used to sit in `listRealWorkspaceProjects` at `packages/cli/src/controllers/project.ts`:

```ts
  return sortProjects(
    (data.data ?? [])
      .filter((project) => project.workspace.id === workspace.id)
```

I am not counting this as a finding. It is the case that started the audit, and it is fixed. It matters here only for reachability: every project-scoped command in both the legacy shell and the v8 tree reads through this function, so the findings below that used to be masked by it are now reachable.

One detail from it survives the merge. `listRealWorkspaceProjects` still reads only `data.data` and never follows `pagination.nextCursor`, unlike `listBranches` at `controllers/branch.ts:129-155`, `listDatabases` at `lib/database/provider.ts:244-273` and `listBuckets` at `adapters/bucket/management-provider.ts:48-77`, which all paginate. A workspace with more projects than one page silently loses the rest — a second way for `project list` to under-report while exiting 0. Rechecked against `origin/main` on 2026-08-12: still absent.

## Findings

Each finding describes the code as it stood when the audit was written. Where a finding has since been fixed, a **Status** line under the heading says so and the prose below it is left as the record of what was wrong. A finding with no Status line is still live.

### 1. `app rollback` with no `--to` rolls forward, and reports it as a rollback

`packages/cli/src/controllers/app.ts:3200-3209`, reached from `runAppRollback` at `:1975-1979`.

```ts
function resolveRollbackTarget(
  deployments: AppDeploymentSummary[],
  currentLiveDeploymentId: string | null,
): AppDeploymentSummary {
  const previousDeployment = deployments.find(
    (deployment) => deployment.id !== currentLiveDeploymentId,
  );
```

The CLI decides which deployment is "the previous one" by taking the first entry in a newest-first list that is not the live one. The list is sorted newest-first by the provider at `packages/cli/src/lib/app/app-provider.ts:690-695`.

**Is there a case where it is correct?** Only when the live deployment is also the newest one. The CLI itself creates the case where it is not. After `app deploy --no-promote` (`packages/cli/src/commands/app/index.ts:253`), the list reads `[unpromoted candidate, live, older…]`, so this returns the deployment the user deliberately chose not to promote. `runAppRollback` then calls `promoteDeployment` on it and returns `status: "running", live: true, previousLiveDeploymentId: <the version they were on>`. The user asked to go back and was moved forward onto the build they were holding, described as a successful rollback. The same thing happens after any rollback followed by a new deploy.

Underneath it is a rename. At `app-provider.ts:686` the provider maps the API's `latestDeploymentId` onto a field it calls `liveDeploymentId`:

```ts
          liveDeploymentId: appResult.value.latestDeploymentId ?? null,
```

Latest and live are the same value only until someone uses `--no-promote`. The CLI renamed one API fact into a different one and then built the rollback decision on the renamed version.

**What breaks on an API change.** If the API's default deployment ordering changes, or the provider's sort is removed, this promotes an arbitrary deployment. "Which deployment is live" is a fact the API states; the CLI is re-deriving it from list position.

**Reachable.** Yes, `prisma-cli app rollback` in the published binary. Destructive, silent, reported as success.

### 2. `postgres usage` prints `0` for a metric the API did not send, in a unit the CLI chose

**Status.** Fixed in #158. `normalizeUsageMetric` carries both `used` and `unit` as `null`, the card reads `unknown`, and stdout and `--json` leave the field empty.

`packages/cli/src/lib/database/provider.ts:666-686`:

```ts
    metrics: {
      operations: {
        used: usage.metrics?.operations?.used ?? 0,
        unit: usage.metrics?.operations?.unit ?? "ops",
      },
      storage: {
        used: usage.metrics?.storage?.used ?? 0,
        unit: usage.metrics?.storage?.unit ?? "GiB",
      },
    },
```

**Is there a case where it is correct?** For `used`, none. Zero is a real, meaningful measurement, and it is the answer a user is most likely to act on — "we have used nothing this period" is what you check before deciding you have headroom. Substituting it for "the API did not report this" makes those two states indistinguishable. For the units, none either: `ops` and `GiB` are guesses about how the platform denominates the values, and if the API ever reports storage in `MiB` or `bytes`, the number is printed against the wrong unit and is wrong by three orders of magnitude.

**What breaks on an API change.** Renaming `metrics.operations` to anything else, or nesting it, produces `0 ops` and `0 GiB` with no error. The adjacent `period.start ?? ""` and `generatedAt ?? ""` at least degrade to an empty field.

**Reachable.** Yes. `v8/postgres/usage.ts:33-42` prints `${used} ${unit}` into the human card, the stdout lane and the `--json` record. Unlike most of the placeholders in the v8 presentation layer, this one is not confined to the human lane — `stdoutFieldRows` at `:50-58` emits `String(result.metrics.operations.used)`, so a script consuming stdout gets the invented zero too.

### 3. `postgres list` and `postgres show` print `default` in the Status column

**Status.** Fixed in #158. `formatStatus` returns the API's status or `unknown`; `isDefault` no longer reaches the Status cell.

`packages/cli/src/v8/postgres/presentation.ts:23-34`:

```ts
export function formatStatus(database: DatabaseSummary): string {
  return database.status ?? (database.isDefault ? "default" : "unknown");
}

/** ... an absent status is an empty field, and `isDefault` is a
 *  different fact that does not belong in this one. */
export function statusValue(database: DatabaseSummary): string {
  return database.status ?? "";
}
```

When the API reports no status, the human table answers a different question — is this the project's default database — in the Status cell. The comment on the sibling function three lines below states exactly the rule the first function breaks.

**Is there a case where it is correct?** None. `default` is not a value in the status vocabulary, and being the default database says nothing about whether it is running. `unknown` admits ignorance; `default` reads as a status and does not.

**What breaks on an API change.** If `status` is renamed, or omitted from list payloads while kept on show payloads, every row reads `default` or `unknown`, and a stopped or failed database reads `default`.

**Reachable.** Yes, `postgres list` (`v8/postgres/list.ts:22`) and `postgres show` (`v8/postgres/show.ts:28`). The stdout and `--json` lanes are correct, so only the human table misreports — but that is the lane a person reads before deciding nothing is wrong.

### 4. `resolveDatabase` substitutes a stale row when the API says the database is gone

**Status.** The stale row is fixed in #158: a `null` from `showDatabase` now raises `DATABASE_NOT_FOUND`, which the postgres mapper emits as `POSTGRES.NOT_FOUND`. The `ensureProjectId` concern in the last paragraph stands — it still fills in a `projectId` the API did not send.

`packages/cli/src/controllers/database.ts:947-952`:

```ts
  const selected = matches[0];
  const shown = await provider.showDatabase(selected.id, {
    projectId: target.project.id,
    signal,
  });
  return ensureProjectId(shown ?? selected, target.project.id);
```

`showDatabase` returns `null` for exactly one condition: a 404 that is not a plan-limit error (`lib/database/provider.ts:287-292`). That is the API saying the database no longer exists. The `?? selected` treats it as a reason to use the row from the list call made moments earlier, and the command proceeds.

**Is there a case where it is correct?** For a read-only command you could argue slightly stale metadata beats a failure. For `postgres remove` there is none — the database was deleted between the two calls, and the CLI is about to name it in the destructive-operation confirmation prompt as though it still existed. A `databaseNotFoundError` helper sits twelve lines above and is not used.

`ensureProjectId` (`database.ts:955-960`) then fills in a `projectId` the API did not send, using whichever project the current directory resolved to. On `create` and `restore` that is a fair echo of what the CLI just asked for. On this path it is an assumption.

**Reachable.** Yes. `resolveDatabase` is the entry point for `postgres show`, `remove`, `usage`, `restore`, `backup list`, `connection list` and `connection create`.

### 5. The `live` flag users read is computed by the CLI, and this laptop's cache outranks the API

`packages/cli/src/controllers/app.ts:1169-1176`:

```ts
        live: providerLiveDeploymentId
          ? deployment.deployment.id === providerLiveDeploymentId
          : knownLiveDeploymentId
            ? deployment.deployment.id === knownLiveDeploymentId
            : deployment.deployment.live,
```

Three tiers of precedence, invented here. Tier two, `knownLiveDeploymentId`, is read from this machine's local state store at `:1149-1157` — a record of what this machine last deployed. It outranks `deployment.deployment.live`, the field the API just sent.

**Is there a case where it is correct?** Tier one is fine. Tier two has none. Local state written by past runs on one laptop is never a better authority than the response in hand. If a teammate promoted a different version from the Console, this machine reports `live: true` for the wrong deployment and `live: false` for the real one.

Two things make it worse. `listDeployments` sets `live: null` on every row (`app-provider.ts:700`), so the middle tier of `resolveCurrentLiveDeploymentId` at `app.ts:3142-3147` — `deployments.find(d => d.live === true)` — never fires in real mode, and the local cache becomes the effective fallback everywhere. And `applyLiveDeploymentHint` at `app.ts:3183-3198` rewrites `live` on every row the API returned to match the CLI's computed answer, so `app show` and `app list-deploys` display a derived flag, not a reported one.

**Reachable.** Yes: `app show-deploy`, `app show`, `app list-deploys`.

### 6. Custom domains are refused on any production branch not named `production` or `main`

`packages/cli/src/controllers/app.ts:3714-3716`, used as a requirement at `:2143-2154`:

```ts
function toBranchKind(name: string): BranchKind {
  return name === "production" || name === "main" ? "production" : "preview";
}
```

```ts
  const branch = resolveDomainBranch(options?.branchName);
  if (toBranchKind(branch.name) !== "production") {
    throw new CliError({
      code: "BRANCH_NOT_DEPLOYABLE",
      summary: "Custom domains require the production branch",
      why: `Custom domains on preview branch "${branch.name}" are not supported in Public Beta.`,
```

The CLI decides whether a branch is production by comparing its name against two string literals. The API states this directly: `resolveAppProjectContext` twelve lines above reads `remoteBranch.role` (`app.ts:3709`), and `RawBranchRecord.role` is declared at `controllers/branch.ts:35` and `controllers/app-env.ts:86`.

**Is there a case where it is correct?** Only for projects whose production branch happens to be called `production` or `main`. A project on `master`, `prod`, `trunk` or `release` is told its production branch is a preview branch, and a supported operation is refused with a confident explanation of why it cannot work. No API change is needed for this to be wrong — it is wrong today for naming conventions that already exist.

**Reachable.** Yes. `--branch <name>` is wired to all five domain subcommands (`commands/app/index.ts:413-417`). The same function is also the fallback branch kind when `--branch` is explicit (`app.ts:3435-3439`), so the `branch.kind` reported in `app show`, `promote`, `rollback` and `remove` output can be wrong the same way.

### 7. `project env list` silently drops variable classes the CLI has not heard of

`packages/cli/src/controllers/app-env.ts:906-911`:

```ts
      filter: (row) =>
        row.branchId === null &&
        (row.class === "production" || row.class === "preview"),
```

The request is already scoped by `projectId`. This narrows the result to two hardcoded class values.

**Is there a case where it is correct?** None. It encodes a guess about which classes exist, and the API is the thing that knows.

**What breaks on an API change.** The day a `development`, `staging` or `build` class appears, those variables vanish from the overview listing with no warning and exit 0. A user checks whether a variable is set, is told it is not, and sets it again — which is the #144 failure mode with a different noun.

**Reachable.** Yes, `project env list` with no `--role` and no `--branch` and no local git branch (`app-env.ts:412`, `:688-696`).

### 8. `app promote` and `app rollback` assert a status nobody observed

`packages/cli/src/controllers/app.ts:1908-1912` and `:2020-2024`:

```ts
      deployment: {
        ...targetDeployment,
        status: "running",
        live: true,
      },
```

**Is there a case where it is correct?** `live: true` is fair — the CLI just made that true. `status: "running"` has none. A 2xx from promote means the traffic switch was accepted, not that the process is healthy. And when `targetAlreadyLive` is true (`:1868`, `:1980`) no call is made at all, and the CLI still writes `status: "running"` over a status it copied from a list row it never refreshed.

**Reachable.** Yes. The user sees `status: running` for a deployment that may be crash-looping, and `--json` carries the same claim to any script reading it.

### 9. `postgres restore` puts an invented status in quotation marks

`packages/cli/src/v8/postgres/restore.ts:45`:

```ts
          `The restore is running; the database status is "${result.database.status ?? "recovering"}" until it completes.`,
```

**Is there a case where it is correct?** None as written. Saying "the restore is running" would be fine — the CLI knows that. Naming a status in quotation marks attributes a specific word to the platform, and if the API sent no status the CLI is quoting itself. This runs immediately after an irreversible operation, and the worst case is that the restore failed, the API omitted the status for that reason, and the user is told it is `recovering`.

**Reachable.** Yes, `postgres restore` is mounted at `v8/cli.ts:142`.

### 10. `git connect` and `git disconnect` report automation capabilities the API never sent

`packages/cli/src/controllers/project.ts:2143-2173`:

```ts
    installation: {
      id: record.installationId,
      status: "connected",
    },
    automation: {
      branches: record.status === "active",
      pullRequests: false,
      comments: false,
    },
```

Three inventions in one object, all of which reach the `--json` payload of both commands as though the platform had reported them. The installation status is hardcoded. Branch automation is re-derived from the connection status. Pull-request and comment automation are hardcoded `false`.

**Is there a case where it is correct?** For `pullRequests` and `comments`, only by coincidence: they are right for exactly as long as the platform does not ship those features, and they will keep saying `false` on the day it does. For `installation.status` there is none — the record existing says nothing about whether the GitHub App installation is currently healthy or suspended, and the API does model this: `findRepositoryInInstallations` at `project.ts:1755` reads a real `installation.suspended` flag.

Line 2146, `const [owner = "", name = ""] = record.repoFullName.split("/")`, silently yields empty strings for any `repoFullName` in a different shape.

**Reachable.** Yes, `v8/git/connect.ts:207,257` and `v8/git/disconnect.ts:89`. A script reading `automation.pullRequests` gets a wrong answer, not an error.

### 11. `branch list` shows an "Env map" column that is the Role column again

`packages/cli/src/controllers/branch.ts:161-168`, rendered at `v8/branch/list.ts:21-25`:

```ts
export function toBranchSummary(branch: RawBranchRecord): BranchSummary {
  return {
    id: branch.id,
    name: branch.gitName,
    role: branch.role,
    envMap: branch.role,
  };
}
```

**Is there a case where it is correct?** None. The API states one fact; the CLI presents it twice under two headings, the second implying a relationship between the branch and an environment mapping that the API never described. Every row shows identical values in adjacent columns, which reads to a user as two facts that happen to agree rather than as one fact printed twice — so the wrong inference is the natural one.

**Reachable.** Yes, `branch list` is mounted.

### 12. `project env` add, update and remove pick a row by re-filtering what the API already filtered

`packages/cli/src/controllers/app-env-api.ts:57-60`:

```ts
  const matches = (data.data as RawEnvironmentVariable[]).filter((row) =>
    rowMatchesExactScope(row, resolved),
  );
  return matches[0] ?? null;
```

The GET immediately above already sent `projectId`, `class`, `key` and `branchId` as query parameters. The comment at `:36` says the server-side filter is the one that matters. This re-applies `class` and `branchId` client-side and takes the first survivor.

**Is there a case where it is correct?** None. It is a duplicate of a decision the API made. If the API ignored one of the parameters, the right response is to fail loudly, not to quietly narrow the set. And `matches[0]` picks arbitrarily when more than one row comes back, where `resolveDatabase` (`database.ts:943`) and `resolveProjectForSetup` (`lib/project/setup.ts:53`) both raise an ambiguity error instead.

**What breaks on an API change.** `RawEnvironmentVariable` is hand-declared at `app-env-api.ts:12-19`, not generated, so a new `class` value or a change in how branch scoping is represented compiles fine and matches nothing at runtime. `env update` and `env remove` then report `ENV_VARIABLE_NOT_FOUND` for a variable that exists, and `env add` proceeds to create a duplicate.

**Reachable.** Yes, and consequential: in `env remove` the id of the chosen row is what gets passed to `DELETE /v1/environment-variables/{envVarId}`. A wrong match deletes the wrong variable and reports success. The `--file` paths call this once per key (`app-env-file.ts:216-239`).

### 13. The CLI computes the effective environment itself

`packages/cli/src/controllers/app-env.ts:986-1009`:

```ts
  const byKey = new Map<string, RawEnvironmentVariable>();
  for (const row of rows) {
    if (row.branchId === null && !byKey.has(row.key)) {
      byKey.set(row.key, row);
    }
  }
  for (const row of rows) {
    if (row.branchId === resolved.apiTarget.branchId) {
      byKey.set(row.key, row);
    }
  }
```

This re-implements variable inheritance — project-level rows as the base, branch rows overriding by key — and presents the merged result as the branch's environment.

**Is there a case where it is correct?** It is correct for exactly as long as the platform's precedence rule is "branch beats project-level within the same class, last write wins". That is a business rule the API owns, and the CLI is asserting it from two fields.

**What breaks on an API change.** A third class, an explicit precedence field, a per-key "do not inherit" marker, or a project-level variable scoped to a subset of branches — any of those produce a wrong effective list with no error.

**Reachable.** Yes, `project env list --branch <name>` and the git-branch-inferred path at `app-env.ts:668-685`. This is the list a user reads to check what a preview deploy will see, so a wrong answer here gets acted on.

### 14. `toMetadata` relabels a row with the scope the CLI asked for

`packages/cli/src/controllers/app-env-api.ts:63-72`:

```ts
  const rowScope =
    row.branchId === null
      ? ({ kind: "role", role: row.class } satisfies EnvScopeDescriptor)
      : requestedScope;
```

**Is there a case where it is correct?** The `branchId === null` branch is correct — the row genuinely is role-scoped. The other branch has none: it discards what the API said about the row and substitutes what the CLI requested, so a row returned under a different branch than the one asked for is relabelled to match the request. `formatDescriptorLabel` at `:120-128` then renders it with `scope.role ?? "unknown"` and `branch:${scope.branchName ?? scope.branchId ?? "unknown"}`.

**Reachable.** Yes. The string this produces is the `source` column — the first cell of the `project env list` table (`v8/project/env-shared.ts:108-112`). The user reads a scope the CLI assigned.

### 15. `normalizeDatabase` invents a precedence across four spellings of the branch name

`packages/cli/src/lib/database/provider.ts:549-564` and `627-632`:

```ts
    branchId: database.branchId ?? database.branch?.id ?? null,
    branchName:
      database.branchGitName ??
      database.branchName ??
      database.branch?.gitName ??
      database.branch?.name ??
      null,
```

**Is there a case where it is correct?** As a short-lived bridge across two API versions, yes. As permanent code, no — `branch.gitName` and `branch.name` are genuinely different values, a git ref and a display name, and this merges them into one field ranked by guess. Nobody reading this can tell which shape the API actually returns, and the day it populates a different one, the branch column in `postgres list` changes meaning without changing shape. `normalizeRegion` does the same across three candidates, and `normalizeConnection` at `:573` does `connection.name ?? connection.id`, printing an id in a column headed Name.

**Reachable.** Yes, every `postgres` command.

### 16. `resolveSessionRef` lost the `wksp_` prefix handling the code beside it has

`packages/cli/src/v8/auth/session-ref.ts:23-25`:

```ts
  const wanted = ref.trim();
  const byId = sessions.find((session) => session.workspaceId === wanted);
```

`session.workspaceId` is the bare `workspace_id` claim. The resolver this replaces, `workspaceMatchesRef` at `packages/cli/src/auth/token-storage.ts:761-773`, strips the prefix from both sides on purpose:

```ts
    stripWorkspacePrefix(workspace.credentialWorkspaceId) ===
      stripWorkspacePrefix(ref) ||
    stripWorkspacePrefix(workspace.id) === stripWorkspacePrefix(ref) ||
```

**Is there a case where it is correct?** Only when the user types the bare claim form. A user pasting the id from the Console or from an API response used to work and no longer does. This is the #144 comparison exactly — bare against prefixed — and the code that knows about the two forms is one directory away.

**Reachable.** Yes, `auth workspace use` (`v8/auth/workspace-use.ts:110`) and `auth workspace logout` (`v8/auth/workspace-logout.ts:87`). It ranks below the silent findings because the failure is a loud `noSessionForWorkspaceError`, not a wrong answer.

### 17. The local pin comparisons repeat the #144 shape, and treat "not in this list" as "does not exist"

`packages/cli/src/lib/project/resolution.ts:636-652`, reached from every project-scoped command:

```ts
  if (localPin.kind === "present") {
    if (localPin.pin.workspaceId !== options.workspace.id) {
      return Result.err(new LocalProjectWorkspaceMismatchError({...}));
    }
    const project = projects.find(
      (candidate) => candidate.id === localPin.pin.projectId,
    );
    if (!project) {
      return Result.err(new LocalStateStaleError());
    }
```

and the same pair at `packages/cli/src/controllers/project.ts:118-123`.

**Is there a case where it is correct?** The workspace comparison is correct only because today the same claim value both writes and reads the pin. It has no defence against a pin written by a differently-formatted claim, by the other CLI version, or by a future API form — which is precisely how #144 happened. PR #144 removes the equivalent comparison from `readProjectListLocalBinding` for that reason; this copy is outside its diff.

The `projects.find(...)` existence check has no correct case at all: it treats absence from a list the CLI assembled — filtered today, unpaginated always — as proof the project does not exist. `resolveExplicitProject` at `:558-573` does the same for user input, matching `project.id === projectRef || project.name === projectRef` exactly and case-sensitively, so the CLI answers "does this project exist" rather than asking.

**Reachable.** Yes. The user is told to re-link a correctly linked directory, or gets `PROJECT_NOT_FOUND` for a project that exists.

### 18. A workspace with no fetched name is reported as being named after its own id

Six places take part in one loop:

- `packages/cli/src/v8/resources-shared/workspace.ts:35-38` — `name: credential.workspaceName ?? credential.workspaceId`
- `packages/cli/src/v8/auth/session-ref.ts:83-85` — `return session.workspaceName ?? session.workspaceId;`
- `packages/cli/src/v8/auth/credential-card.ts:26-31` — same substitution
- `packages/cli/src/auth/token-storage.ts:244-247` — stores `{ id: tokens.workspaceId, name: tokens.workspaceId }`
- `packages/cli/src/auth/token-storage.ts:779-781` — `return name === credentialWorkspaceId ? UNKNOWN_WORKSPACE_NAME : name;`
- `packages/cli/src/auth/workspaces.ts:229-235` and `legacy-state.ts:70-81` — detect the placeholder by comparing against the literal string `"Unknown workspace"`

The storage layer writes the id into the name field, another layer detects that and swaps in a magic string, and two more layers detect the magic string to decide whether to re-fetch.

**Is there a case where it is correct?** The `?? workspaceId` display substitutions are defensible as a convention — the user gets something addressable. The magic-string round trip is not. A workspace genuinely named `Unknown workspace`, or genuinely named after its id, is treated as never-hydrated forever, so `auth workspace list` fires an extra `/v1/workspaces/{id}` request on every invocation and never settles. `resolveOAuthWorkspaceMetadata` at `workspaces.ts:256-271` completes the loop: it fills both fields from the claim, then compares the result back against the claim and returns `null` — meaning "the lookup failed" — when they agree.

**What breaks on an API change.** If the API returns the prefixed id while credentials keep the bare one, the `workspace.id === workspace.credentialWorkspaceId` check at `workspaces.ts:231` stops firing, hydration goes dead, and every workspace displays as its id.

**Reachable.** Yes, in the `workspace` field printed by most project commands and every auth command.

### 19. Pagination stops silently when the API says there is more but sends no cursor

`packages/cli/src/lib/database/provider.ts:266-272`, `adapters/bucket/management-provider.ts:73-76` and `:147-150`, `controllers/branch.ts:151-155`:

```ts
        if (
          !result.data.pagination.hasMore ||
          !result.data.pagination.nextCursor
        ) {
          break;
        }
```

**Is there a case where it is correct?** The `!hasMore` half, yes. The second half is the CLI deciding what to do when the API contradicts itself, and the decision it makes is to return a partial list as if it were complete. `hasMore: true` with a null cursor is the API stating the response is incomplete; the CLI answers by dropping the statement. `normalizeBackupList` at `provider.ts:702-704` does the softer version of the same thing with `hasMore: body.pagination?.hasMore ?? false`.

**Reachable.** Yes, on every list command. A truncated list is indistinguishable from a complete one.

## Same family, lower severity

These are the same instinct in smaller doses. Each is real; none is worth its own section.

- **First branch wins for a name query.** `controllers/app-env.ts:633-635`, `:758-766`, `:789-791` take `[0]` from a `?gitName=` list response, ignore any second row, and never paginate. Correct only if git names are unique per project and the query is exact — neither is checked. A silent write to the wrong branch scope if either assumption fails.
- **Errors classified by reading their prose.** `controllers/app.ts:2508-2543` and `:2568-2572` decide whether a domain error is a quota problem or a DNS problem with `text.includes("quota")` and a regex over the human-readable message, and scrape the DNS target out of it with `/\b((?:[a-z0-9-]+\.)+prisma\.build)\b/`. The API sends a structured `code` that is read but not used for these branches. `isMissingProjectError` at `:5012-5014` compares `error.message === "Resource Not Found"` exactly. A prose rewrite on the server reroutes users to the wrong fix.
- **`project list` prints `none` for a region.** `v8/project/list.ts:20-26`. Absence is manufactured upstream: `controllers/project.ts:1463-1465` only copies `defaultRegion` when that literal key is present on the response object, so a rename makes every row read `none`. The stdout lane correctly uses `""`.
- **Bucket key role coercion.** `controllers/bucket.ts:412-414`: `role === "read" ? "read" : "read_write"`. Not reachable with a bad value today — commander constrains it with `.choices([...])` at `commands/bucket/index.ts:210-213`. It is a trap rather than a live defect: the day a third role is added to `choices`, this silently issues read-write credentials for it. A credential-scope decision should be the API's refusal, not a ternary's default.
- **`build logs` prints the word `undefined`.** `controllers/build.ts:97-113` treats every NDJSON record that is not `type: "log"` as terminal, so a new `status` or `heartbeat` record has `record.code === undefined`, fails the `!== "end"` check, and writes `undefined` to stderr for each one. `JSON.parse(line)` at `:137` has no validation and throws out of the read loop on one malformed line. `sawError` at `:71-74` only fires on `kind === "error"`, so a failure signalled some other way exits 0.
- **`agent status` reports zero skills rather than a parse failure.** `controllers/agent.ts:363-384` returns `null` for any record missing a field and `flatMap` drops it, so a rename in the sibling tool makes `skillsInstalled: false` and tells the user to reinstall, with no sign that records were discarded.
- **`local-state.ts` invents a branch name.** `adapters/local-state.ts:41-58` and `:92-94` default the active branch to the literal `"preview"` for a missing or partial state file. A hardcoded assumption about the platform's branch vocabulary living in a file reader.
- **The local pin file rejects any future field.** `lib/project/local-pin.ts:424-431` requires `Object.keys(value).length !== 2`. A `.prisma/local.json` written by any version that adds a third field reads as invalid shape and surfaces as `LOCAL_STATE_STALE`.
- **A dead comparison.** `lib/project/resolution.ts:662-673` compares `platformMapping.workspace.id === options.workspace.id`, but `resolveDurablePlatformMapping` at `:586-588` always returns `null`. Unreachable today, and it is the #144 comparison waiting for someone to implement the function.

## Looked at and not reporting

`repositoryFullNamesMatch` (`controllers/project.ts:2260-2262`) lowercases both sides, which is right — GitHub owner and repo names are case-insensitive. `readFirstSourceRepository` (`:2092-2116`) sends `limit: 1` and takes `data.data[0]`, which is the API choosing, not the CLI. `sortProjects`, `sortDatabases` and `sortBranches` order a complete set for display rather than re-deriving an order the API stated. The `?? "unknown"` placeholders in the v8 presentation layer — `v8/postgres/presentation.ts:55-65`, `connection-list.ts:25`, `list.ts:18-19`, `bucket/presentation.ts:17` — are each paired with a stdout row that emits the raw value, which is the right split; they matter only as the area affected when a field is renamed, and `unknown` at least reports ignorance honestly. (`unscoped` for an absent branch name is weaker: it asserts the resource is not branch-scoped, which is a different claim from "the API did not say".) That parenthetical under-rated it. Reading the live API afterwards showed it returning `branchId` with `branchName: null` for every database in a real workspace, so the Branch column read `unscoped` for databases that were all branch-scoped — a wrong answer on every row, not a weak placeholder. Fixed for `postgres list` and `show` in #158, where the label falls back to `branchId` and only a missing id can produce `unscoped`. The same substitution in the other listings named here was not audited against live output and may be wrong in the same way. `v8/project/context.ts:42-54`'s `refuseUnknownReads` proxy is the opposite of this defect class — it refuses to invent rather than filling a gap. The `v8/*/errors.ts` mappers pass unmapped API codes through as `GROUP.<RAW_CODE>` by explicit rule. `v8/auth/whoami.ts:80-98` merges the token claims with `/v1/me`, which the comment above it justifies as the offline fallback; the reasoning is sound, though the `samePerson` check treats a missing id on either side as proof of a match, so if `/v1/me` stops returning `user.id` the CLI will splice one person's email onto another's name — worth a comment, not a finding.

## What the pattern is

Three habits produce every finding above.

The CLI re-derives state the API already states — which deployment is live, which branch is production, which environment variables are in effect, what a database's status is (findings 1, 3, 5, 6, 8, 11, 13).

The CLI narrows a collection the API scoped, using assumptions about what values exist (7, 12, 19, and the reference case).

The CLI supplies an answer where the API declined to give one — a zero for a metric, a status for a restore, a capability flag for an integration, a name for a workspace (2, 4, 9, 10, 14, 15, 18).

The first two produce wrong answers under API change. The third produces wrong answers today, without any change at all.
