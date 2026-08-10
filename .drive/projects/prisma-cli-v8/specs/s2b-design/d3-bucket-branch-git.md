# D3 design — bucket (6) + branch list + git (2)

Binding design for dispatch D3. Parent: `conventions.md`; template
from D1. Grounding fact sheet: `facts/facts-d3-bucket-branch-git.md`
(verbatim legacy extraction — part of this doc). Binding corrections
to the inventory: bucket key create's stdout lines are
`S3_ENDPOINT=` / `S3_ACCESS_KEY_ID=` / `S3_SECRET_ACCESS_KEY=` /
`S3_BUCKET=` in that order; `branch list` resolution passes no
commandName (its setup-required copy says "this command").

## 1. Group mounting

| group | brief |
| --- | --- |
| `bucket` | Manage object-store buckets for a project |
| `bucket key` | Manage access keys for an object-store bucket |
| `branch` | View your Platform branches |
| `git` | Manage Git repository connections for a project |

Mount paths `bucket list|create|delete`,
`bucket key list|create|delete`, `branch list`,
`git connect|disconnect`. Family keys `bucketList`, `bucketCreate`,
`bucketDelete`, `bucketKeyList`, `bucketKeyCreate`,
`bucketKeyDelete`, `branchList`, `gitConnect`, `gitDisconnect`.

## 2. Shared machinery

### 2.1 Error mappers

`v8/bucket/errors.ts` (BUCKET.*), `v8/branch/errors.ts` (BRANCH.*),
`v8/git/errors.ts` (GIT.*) per conventions §4. Complete maps:

Bucket: `USAGE_ERROR` domain bucket (2) → `BUCKET.USAGE_ERROR`;
`CONFIRMATION_REQUIRED` (2) → `BUCKET.CONFIRMATION_REQUIRED`;
`BUCKET_KEY_SECRET_MISSING` (1) → `BUCKET.KEY_SECRET_MISSING`;
`BUCKET_API_ERROR` / passthrough X (1) → `BUCKET.API_ERROR` /
`BUCKET.X`. Fixture-only `BUCKET_NOT_FOUND`, `BUCKET_KEY_NOT_FOUND`,
`BRANCH_NOT_FOUND` (bucket domain) die with fixture machinery — no
v8 entries (real mode passes API codes through; divergence entry).
Project-resolution errors (bucket list/create) → `PROJECT.*` via
D1's shared mapper. Workspace-required → `AUTH.USAGE_ERROR`.

Branch: `BRANCH_API_ERROR` / passthrough X (1) → `BRANCH.API_ERROR`
/ `BRANCH.X`; resolution family → `PROJECT.*`; workspace →
`AUTH.USAGE_ERROR`.

Git: `USAGE_ERROR` domain project raised by git commands (2) →
`GIT.USAGE_ERROR`; `REPO_PROVIDER_UNSUPPORTED` (2) →
`GIT.REPO_PROVIDER_UNSUPPORTED`; `REPO_ALREADY_CONNECTED` (1) →
`GIT.REPO_ALREADY_CONNECTED`; `REPO_INSTALLATION_REQUIRED` (1) →
`GIT.REPO_INSTALLATION_REQUIRED`; `REPO_NOT_ACCESSIBLE` (1) →
`GIT.REPO_NOT_ACCESSIBLE`; `REPO_NOT_CONNECTED` (1) →
`GIT.REPO_NOT_CONNECTED`; `REPO_CONNECTION_FAILED` (1) →
`GIT.REPO_CONNECTION_FAILED` (status-aware fix text verbatim, incl.
the 404/409/422 variants; meta `{status, apiCode?}`); legacy
401/403 → `AUTH_REQUIRED` mapping does not port (SDK auth failures
propagate → `CLI.CREDENTIALS_REQUIRED`; divergence entry, same class
as D1). Resolution family → `PROJECT.*` (with `commandName:
"git connect"` / `"git disconnect"` preserved).

All copy verbatim + conventions §0-substitutions (command strings →
`${CLI_NAME} …`, `--trace` fix text, package-runner formatter
dropped). `PROJECT_AMBIGUOUS`'s hardcoded `app deploy` nextStep
ports verbatim (pre-existing quirk; divergence note, not a fix —
consistent with D1).

### 2.2 Operation calls

- Bucket: `createManagementBucketProvider(ctx.api)` →
  `listBuckets` / `createBucket` / `deleteBucket` / `listKeys` /
  `createKey` / `deleteKey` (signatures per fact sheet S5).
  `requireBucketContext` equivalent: workspace (conventions §3a) +
  `resolveProjectTarget` with `commandName` `"bucket list"` /
  `"bucket create"` — only for list/create. delete + all key
  commands: provider only, NO workspace/project resolution (legacy
  `requireBucketProviderOnly`).
- Branch: `listBranches(ctx.api, projectId, ctx.signal)`
  (controllers/branch.ts — export per D1 §0.4 rule); resolution via
  `resolveProjectTarget` with NO explicitProject and NO commandName
  (quirk ports verbatim).
- Git: the flow functions in controllers/project.ts re-homed per
  §3.8 below: `readGitOriginRemote`, `parseGitHubRepositoryUrl`,
  `readFirstSourceRepository`, `listScmInstallations`,
  `findRepositoryInInstallations`, `createGitHubInstallIntent`,
  `toRepositoryConnection`, inline `ctx.api.POST/DELETE` on
  source-repositories — imported/exported, not reimplemented.

## 3. Per-command design

Common: `needs: { credentials: true }`; data = legacy result minus
`verboseContext`; no exitCodes.

### 3.1 `bucket list` — `v8/bucket/list.ts`

- help.summary `List object-store buckets for the resolved project`;
  examples `bucket list`, `bucket list --branch preview`,
  `bucket list --json`; flags `project`/`branch` (briefs `Project id
  or name` / `Branch git name`).
- Handler: workspace → resolve project (`"bucket list"`) →
  `provider.listBuckets({ projectId, branchName, signal })`.
- data `{ projectId, projectName, branchName: branchName ?? null,
  buckets }`.
- human: summary info `Listing object-store buckets for the resolved
  project.`; fields `project:` (+ `branch:` when set); empty → list
  `["No buckets found."]`; else table
  `Name | Id | Status | Branch | Created` (Branch cell
  `branchId ?? "unscoped"`).
- stdout: table data rows tab-joined. json: legacy
  `serializeBucketList` shape `{ context, items, count, projectId,
  branchName, buckets }`. next: none.
- Tests: success; empty; branch filter passthrough; resolution error
  (`PROJECT.SETUP_REQUIRED`); json; unauth.

### 3.2 `bucket create` — `v8/bucket/create.ts`

- help.summary `Create an object-store bucket`; examples
  `bucket create`, `bucket create --name my-store`,
  `bucket create --branch preview --json`; flags `name:
  flag.string({ brief: "Bucket display name (auto-generated if
  omitted)", placeholder: "name" })`, `project`, `branch`.
- Handler: workspace → resolve (`"bucket create"`) →
  `provider.createBucket({ projectId, name: flags.name?.trim() ||
  undefined, branchGitName: branchName, signal })`.
- data `{ projectId, projectName, bucket }`.
- human: summary ok `` Created bucket "${bucket.name}" in
  ${projectName}[ / ${branchId}] `` (legacy `formatBucketTarget`;
  the `Creating bucket...` progress line drops — d2 class).
- stdout: none. json: strip shape. next: none.
- Tests: success (named + auto-name/undefined passthrough); API
  error passthrough → `BUCKET.<code>` exit 2; json; unauth.

### 3.3 `bucket delete <bucketId>` — `v8/bucket/delete.ts` (consent)

- help.summary `Delete a bucket and all its access keys`; example
  `bucket delete bkt_123`; positional `bucketId` (brief
  `Bucket id`); flag `confirm: flag.string({ brief: "Exact bucket id
  to confirm deletion", placeholder: "bucket-id" })`.
- Handler: blank id → `BUCKET.USAGE_ERROR` (`Bucket id required` /
  `Bucket deletion needs a bucket id.` / nextActions from fix +
  `${CLI_NAME} bucket list`); consent per conventions §5 (hold
  lifted): `ctx.prompt.consent("Deleting this bucket permanently
  removes all objects and access keys.", { token: id })`; then
  provider-only → `provider.deleteBucket(id, { signal })`.
- data `{ bucket: { id } }`.
- human: summary ok `Deleting object-store bucket.`; fields
  `bucket: id`; list `["Bucket and all its access keys were
  removed."]`.
- stdout: none. json: `{ bucket: { id } }`. next: none.
- Tests: success; blank id; consent matrix (grant/deny/
  non-interactive/cancel/mismatch); API error; json; unauth.

### 3.4 `bucket key list <bucketId>` — `v8/bucket/key-list.ts`

- help.summary `List access keys for a bucket`; examples per fact
  sheet; positional `bucketId`.
- Handler: blank → `BUCKET.USAGE_ERROR` (`Bucket key listing needs a
  bucket id.`); provider-only → `provider.listKeys`.
- data `{ bucketId, keys }`. human: summary info `Listing access
  keys for bucket.`; fields `bucket: id`; empty → `["No keys
  found."]`; table `Name | Id | Role | Hint | Created`.
- stdout: table rows tab-joined. json: legacy shape `{ context:
  { bucket }, items, count, bucketId, keys }`. next: none.
- Tests: success; empty; blank id; json; unauth.

### 3.5 `bucket key create <bucketId>` — `v8/bucket/key-create.ts` (secret)

- help.summary `Create a bucket access key and print its one-time
  credentials`; examples per fact sheet; positional `bucketId`;
  flags `role: flag.enum({ brief: "Access role (default:
  read_write)", values: ["read", "read_write"] })`, `name:
  flag.string({ brief: "Key display name (auto-generated if
  omitted)", placeholder: "name" })`.
- Handler: blank id → usage error (`Bucket key creation needs a
  bucket id.`); role via legacy `resolveKeyRole` semantics
  (`role === "read" ? "read" : "read_write"`); provider-only →
  `provider.createKey({ bucketId, name: trim-or-undefined, role,
  signal })`.
- data `{ bucketId, key, secretAccessKey, accessKeyId, endpoint,
  bucketName }`.
- human: summary ok `` Created key "${key.name}" for bucket
  "${bucketName}". `` + list `["The credentials below are shown once
  — copy them now.", "Set these environment variables to use this
  bucket:"]` + fields block with the four rows, each
  `sensitive: true` where secret (`S3_SECRET_ACCESS_KEY`,
  `S3_ACCESS_KEY_ID`) and plain for endpoint/bucket.
- stdout EXACTLY (order pinned):
  `S3_ENDPOINT=${endpoint}`, `S3_ACCESS_KEY_ID=${accessKeyId}`,
  `S3_SECRET_ACCESS_KEY=${secretAccessKey}`,
  `S3_BUCKET=${bucketName}`.
- json: result unchanged (secret included). next: none.
- Tests: success (stdout bytes, masked rows, envelope secret);
  role default (`--role` omitted → read_write on the wire); blank
  id; credentials-missing → `BUCKET.KEY_SECRET_MISSING` copy
  verbatim; json; unauth.

### 3.6 `bucket key delete <bucketId> <keyId>` — `v8/bucket/key-delete.ts`

- help.summary `Revoke and delete a bucket access key`; example per
  fact sheet; positionals `bucketId`, `keyId` (briefs `Bucket id` /
  `Key id`). NO confirm flag, no consent (legacy behavior;
  divergence review note only).
- Handler: either blank → `BUCKET.USAGE_ERROR` (`Bucket id and key
  id required` copy verbatim, nextAction `${CLI_NAME} bucket key
  list <bucketId>`); provider-only → `provider.deleteKey`.
- data `{ key: { id } }`. human: summary ok `Deleting bucket access
  key.`; fields `key: id`; list `["The access key was revoked and
  removed."]`. stdout none; json `{ key }`; next none.
- Tests: success; blank ids (each); API error; json; unauth.

### 3.7 `branch list` — `v8/branch/list.ts`

- help.summary `List Platform branches for the resolved project`;
  examples `branch list`, `branch list --json`. NO args (no
  `--project`; pin/durable resolution only — legacy).
- Handler: workspace → `resolveProjectTarget` (no explicitProject,
  no commandName — quirk verbatim) → `listBranches(ctx.api,
  projectId, ctx.signal)` (cursor pagination to exhaustion,
  production-first then name sort, `envMap = role` copy).
- data `{ projectId, projectName, branches }`.
- human: summary info `Listing branches for the resolved project.`;
  fields `project:`; empty → `["No branches found."]`; table
  `Name | Role | Env map`.
- stdout: table rows tab-joined. json: `{ projectId, projectName,
  branches }`. next: none.
- Tests: success (sort proven: production first, then alphabetical);
  pagination (two pages via fake client); empty; API-code
  passthrough → `BRANCH.<code>`; unbound → `PROJECT.SETUP_REQUIRED`
  with the "this command" why-variant; json; unauth.

### 3.8 `git connect [git-url]` — `v8/git/connect.ts` (poll, R-S2b-7)

- help.summary `Connect the resolved project to a GitHub
  repository`; examples per fact sheet; positional `gitUrl:
  positional.optionalString({ brief: "GitHub repository URL",
  placeholder: "git-url" })`; flag `project`.
- Handler flow (legacy runGitConnect, re-homed):
  1. workspace → resolve project (`"git connect"`).
  2. URL: positional ?? `readGitOriginRemote(ctx.cwd, ctx.signal)`;
     none → `GIT.USAGE_ERROR` (copy verbatim);
     `parseGitHubRepositoryUrl` null →
     `GIT.REPO_PROVIDER_UNSUPPORTED`.
  3. `readFirstSourceRepository(ctx.api, projectId, signal)`:
     same-repo (case-insensitive) → idempotent success with the
     existing connection; different repo →
     `GIT.REPO_ALREADY_CONNECTED`.
  4. Install resolution: `listScmInstallations` +
     `findRepositoryInInstallations`; on miss,
     `createGitHubInstallIntent` → installUrl.
  5. Wait: OPERATOR RULING (2026-08-10, corrected) — `git connect`
     declares `needs: { interaction: true }` (the EXISTING S2a
     mechanism, execution/needs.ts): non-interactive runs fail
     early, before the handler and any side effects, with the
     engine's interaction-required error (exit 2). Commands and
     helpers never read TTY/CI state. The interactive wait flow
     ports against `ctx.prompt.browserWait` (landed, engine commit
     6bb8452: `{ url, message, poll(signal), timeout }` — announce +
     open through the runtime opener + poll on the engine clock;
     timeout → structured timeout error; Ctrl-C → exit 3;
     non-interactive → interaction-required with the URL, unreachable
     here behind needs.interaction) — do not hand-roll polling.
     Binding mapping onto the helper: url =
     installUrl; poll predicate = "the GitHub App installation
     exists" (re-list installations, `findRepositoryInInstallations`
     match); interval/timeout from
     `PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS` (default 2000) /
     `PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS` (default 120000) read
     from ctx.env; announcement copy = the legacy wait line
     verbatim. Outcomes: predicate satisfied → proceed to step 6;
     timeout → the legacy terminal errors
     (`GIT.REPO_NOT_ACCESSIBLE` when inspectableInstallationCount >
     0, else `GIT.REPO_INSTALLATION_REQUIRED`; meta `{repository,
     installUrl, opened}`). Non-interactive runs never reach the
     handler at all (needs.interaction) — divergence entry: legacy
     non-interactive `git connect` succeeded when the repo was
     already reachable and errored with installUrl meta otherwise;
     v8 fails every non-interactive run early with the engine's
     interaction-required error (exit 2). Announce/open/poll events
     and rendering are the HELPER'S — the handler emits no
     endpoint/status events of its own. Exact call surface: bind to
     the landed helper's API at merge-down; any mismatch with this
     mapping is a STOP, not an adaptation.
  6. `ctx.api.POST("/v1/source-repositories", { body: { projectId,
     provider: "github", providerRepositoryId, installationId },
     signal })`; error → `GIT.REPO_CONNECTION_FAILED` family.
- data: `{ workspace, project, resolution, repositoryConnection }`
  (legacy raw shape — it had no serializer; ports as-is).
- human: summary ok `Connecting Git to the resolved project.`;
  fields `project`, `workspace`, `repository` (fullName), `status`;
  list `[<formatGitConnectionDetail(status) verbatim>]`.
- stdout: none. json: result unchanged. next: none.
- Tests: explicit-url success; origin-remote fallback (fake
  `readGitOriginRemote` via cwd-scoped temp git config is NOT used —
  mock the exported function via vi.mock on its module);
  no-url usage error; non-GitHub URL; already-connected idempotent
  success; different-repo conflict; installation-required
  (non-interactive, meta asserted); not-accessible; poll-then-found
  (events asserted: endpoint → status waiting → status connected;
  fake client scripted across two list calls; interval env set to
  1ms); poll timeout; connection-failed 409 fix text; json; unauth.

### 3.9 `git disconnect` — `v8/git/disconnect.ts`

- help.summary `Disconnect the GitHub repository from the resolved
  project`; examples per fact sheet; flag `project`.
- Handler: workspace → resolve (`"git disconnect"`) →
  `readFirstSourceRepository`; none → `GIT.REPO_NOT_CONNECTED`
  (copy verbatim); else `ctx.api.DELETE
  ("/v1/source-repositories/{id}")`; error →
  `GIT.REPO_CONNECTION_FAILED` family. No confirmation (legacy).
- data: `{ workspace, project, resolution, repositoryConnection:
  <the removed connection> }`.
- human: summary ok `Disconnecting Git from the resolved project.`;
  fields `project`, `workspace`, `repository`; list `["GitHub branch
  automation is no longer active for this project."]`.
- stdout none; json raw; next none.
- Tests: success; not-connected; API error; json; unauth.

### 3.8a Dependencies — RESOLVED (merge-down 2026-08-10)

browserWait, ctx.openUrl, and consent tokens are all landed (engine
commit 6bb8452). Nothing in D3 waits; no reordering. The timeout
error browserWait raises on poll expiry replaces the handler-side
timeout branch: catch it and settle the legacy terminal errors
(`GIT.REPO_NOT_ACCESSIBLE` / `GIT.REPO_INSTALLATION_REQUIRED`) per
§3.8 step 5.

## 4. Divergence entries this dispatch adds

D2 classes 2/3/4/7/8/9/10/11 apply, plus:
1. Bucket delete consent prompt added (flag-only legacy) — pinned
   question, OPERATOR DECISION 2.
2. Fixture-only BUCKET_NOT_FOUND / BUCKET_KEY_NOT_FOUND /
   BRANCH_NOT_FOUND die; real-mode API codes pass through as
   `BUCKET.<code>`.
3. git connect: declares needs.interaction — ALL non-interactive
   runs fail early with the engine's interaction-required error
   (exit 2), including the legacy non-interactive success case
   (repo already reachable) and the legacy immediate REPO_* errors
   with installUrl meta; the interactive wait flow moves onto the
   engine's browser-wait helper (its announce/open/poll surface
   replaces the legacy stderr wait line).
4. git connect/disconnect keep their serializer-less raw json result
   (resolution object included) — unchanged, recorded for review
   since other groups strip it.
5. 401/403 → `CLI.CREDENTIALS_REQUIRED` class (as D1).
6. `bucket key create --role`: engine enum error replaces commander
   choices error.

## 5. Legacy test deletion (this dispatch)

Delete fixture-mode cases covering these 9 commands from
`bucket.test.ts` and `branch.test.ts` (whole files if nothing else
remains). git connect/disconnect fixture cases live in
`project.test.ts` / `project-real-mode.test.ts` — delete only the
git-command cases; `git-adapter.test.ts` (URL parsing units) stays.
`branch-controller.test.ts` / `branch-usecases.test.ts` /
`read-branch.test.ts` / `local-branch.test.ts` stay until S2d.

## 6. Conformance rows

One row per command in `assets/s2/parity-divergences-s2b.md`.
