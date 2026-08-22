# S8 parity divergences — the service family's deployment grammar

Every known place where the `service` family as it now ships differs
from what S2c left behind. Same entry format as
[`parity-divergences.md`](parity-divergences.md), and the same standing
ruling behind it (S2 ruling 10: divergences are enumerated, not
discovered).

**The baseline here is v8's own `service` family, not the legacy
platform CLI.** The other files in this directory compare a ported
command against the shipping `prisma-cli`. S8 changes commands that S2c
already ported, so what changes is what a v8 user sees between S2c and
S8. The legacy `app` family is untouched by this slice and keeps its own
spellings.

Two engine-global records apply wholesale and are not repeated per
command: the S1 whoami-scoped record
([`../engine/whoami-parity-divergences.md`](../engine/whoami-parity-divergences.md))
and this directory's `parity-divergences.md` preamble.

## Four commands move under `service deployment`

The four deployment verbs leave the `service` root for a `deployment`
subgroup. The old spellings are **deleted, with no aliases** (R-S8-1;
ruled because v8 is pre-rc and carries no compatibility debt).

| was | is |
| --- | --- |
| `service list-deploys` | `service deployment list` |
| `service show-deploy` | `service deployment show` |
| `service promote` | `service deployment promote` |
| `service rollback` | `service deployment rollback` |

Everything that names them moved together: mount paths, help summaries
and examples, presenter copy, and the `run-command` next actions other
commands emit. The group gained its own brief, "Manage deployments for a
service", next to `service domain`.

**The command ids in the json envelope moved with the paths**, which is
the part a script notices:

| was | is |
| --- | --- |
| `service.list-deploys` | `service.deployment.list` |
| `service.show-deploy` | `service.deployment.show` |
| `service.promote` | `service.deployment.promote` |
| `service.rollback` | `service.deployment.rollback` |

A caller invoking an old spelling gets `CLI.UNKNOWN_COMMAND` (exit 2).
`prisma-cli service promote dep_1` no longer runs anything, and the
suggestion machinery cannot help: `promote` is not a `service` verb any
more, so the near-miss is `service deployment promote`, two tokens away.

## Five commands are new

Net-new surface, so nothing about them is a divergence from a previous
spelling — recorded here so the file describes the whole shipped
grammar:

| command | endpoint |
| --- | --- |
| `service list` | `GET /v1/apps` |
| `service create` | `POST /v1/apps` |
| `service deployment start` | `POST /v1/deployments/{id}/start` |
| `service deployment stop` | `POST /v1/deployments/{id}/stop` |
| `service deployment delete` | `DELETE /v1/deployments/{id}` |

`service create` is the one that changes what is possible rather than
what is spelled: before it, a service could only come into existence as
a side effect of deploying to it.

## `live` derives from the platform record alone

The local CLI cache of "which deployment is live" is **retired in both
directions**. It was read as a fallback when the service record named no
live deployment (`readKnownLiveDeployment`), and it was written by
`promote` and `rollback` after a successful switch. Both are gone: `live`
is now `service.latestDeploymentId` and nothing else.

The store helpers survive because the legacy `app` family still writes
the same key for the same project, and `service remove` still clears it
for that reason. Nothing in the v8 `service` family reads or writes it.

Two user-visible consequences:

- **Where a local cache entry existed, `service deployment list`'s
  rows change from `true`/`false` to `null`.** Only machines whose
  cache held an entry for the service see this: the old resolver fell
  through to the cache when the record named no live deployment (the
  rows the provider maps are always `live: null`, so the middle
  branch never fired), and a cache hit made one row `true` and the
  rest `false`. Without a cache entry the rows were already `null`,
  byte-identical to today. The human table renders all of it the same
  (an empty cell), so this is a **json-only change**, and `null` is
  deliberate: the platform says nothing about which deployment is
  live, and `null` says "unknown" where `false` claimed "not live".
- **A stale cache can no longer make a deployment look live.** On a
  machine that promoted before the change, the old code could report a
  deployment live after the platform had moved on. It cannot now.

## `service show` suppresses `liveUrl` more narrowly than the contract says

R-S8-3 asks for the live url whenever `latestDeploymentId` is set.
`service show` is stricter: it presents `liveUrl` only when the named
live deployment **also appears in the deployment listing it just
fetched**, because it derives the live deployment by finding that id
among the listed rows.

If the platform ever names a `latestDeploymentId` the listing omits, the
service shows `live url: unavailable` rather than the promoted address.
No case was found where the listing omits it — the listing is the same
service's deployments — so this is recorded as a narrower implementation
of the rule, not a known defect.

## `service deployment show`'s url follows liveness

Previously every deployment reported the service's promoted
`appEndpointDomain`. That address serves only the live deployment, so
two things were wrong: a non-live deployment showed a url that does not
reach it, and a service that had never been promoted showed a
placeholder domain that resolves to nothing.

Now the url is the promoted address **only when the shown deployment is
the one the service names as latest**, and the deployment's own
`previewDomain` otherwise.

`service deployment list` is unchanged and still reports per-row preview
domains: identical promoted urls on every row would be wrong, and no
presenter renders that field.

## A service with no live deployment presents no live url anywhere

A service carries an `appEndpointDomain` from the moment it is created,
before anything is deployed to it, and that domain does not resolve
until the first promote. Every presenter added or corrected in this
slice reports a live url only when `latestDeploymentId` is set —
`service show`, `service list`, and `service create` all show
`not deployed` (or `unavailable`) rather than a dead address.

## `service create --branch` resolves *or creates* the named branch

The create body needs a branch id, so the command resolves the branch by
git name and **creates it when it does not exist**. A mistyped
`--branch` therefore silently creates a branch rather than failing.

This is inherited from the provider path the contract grounds the
command in (`resolveOrCreateBranch`, the same helper the deploy flow
uses), and is recorded as a divergence note rather than treated as a
defect: refusing an unknown branch would diverge from how every other
branch-scoped write in this codebase behaves. If it should refuse, that
is a change to the shared helper and affects deploy too.

## `service create` returns an existing service instead of failing

When the name is already taken on the branch the API answers 409, and
the command reports the **existing** service with `existing: true`
rather than erroring. This follows `service domain add` in the same
group, which does the same thing for the same reason, and the result
field plus the summary line ("… already exists on main; showing it")
tell the two cases apart.

**Operator ruling pending on the semantics.** The contract does not rule
on whether `create` should be idempotent. The alternative — a hard
`SERVICE.ALREADY_EXISTS` failure — is a small change in
`createComputeService` and two tests. Recorded so the choice is visible
rather than absorbed.

## Deleting the live deployment leaves a non-resolving `endpointDomain`

The API permits deleting the deployment a service currently points at.
Server-side it detaches the endpoint, stops the VM, deletes it, and
clears the service's `latestDeploymentId` in the same transaction — but
it does **not** clear `appEndpointDomain`. The service is left carrying a
domain that no longer resolves.

No CLI-side guard was added, per the contract: the only 409 documented
on that endpoint is the stop precondition, and promotion is never
consulted. The dead domain is already neutralised at the presenter
layer — with `latestDeploymentId` cleared, every presenter in this slice
reports no live url, which is the same rule the never-promoted case
uses.

Verified against the control plane's own source and integration tests,
not against a live API; the checkout read was one minor ahead of the SDK
version this CLI pins (1.56.0 against 1.55.0), with the delete path
unchanged in shape across it.

## `stop` takes production offline with no consent; `delete` demands a token

Stated because the new grammar puts the verbs side by side, where the
asymmetry is easy to read as an oversight:

- `service deployment stop dep_1` stops the deployment immediately. If
  that deployment is the live one, the service goes offline. **No
  confirmation is asked.**
- `service deployment delete dep_1` requires the deployment id typed
  back, interactively or via `--confirm`. `--yes` alone cannot grant it.

This is contract-faithful. R-S8-2 asks for consent on `delete` only, per
the `service remove` precedent (R-S2b-3), and the line the precedent
draws is reversibility: a stopped deployment can be started again, a
deleted one cannot. Recorded, not changed.

## Not a divergence, recorded because it looks like one

**`service deployment start` checks no precondition of its own.** The
API requires a deployment's artifact to be uploaded before it will
start. The CLI does not test for that: it makes the call, and if the API
refuses, the API's own message is what the user reads (inside
`SERVICE.DEPLOY_FAILED`). Per R-S8-2 the failure is the API's answer
presented properly, not a precondition the CLI invents — so the absence
of a check here is the requirement being met, not a gap in it.

The same holds for `delete` against a running deployment: the API states
the stop precondition, the CLI does not pre-empt it.

## Command grammar cleanup (2026-08-21 PM review)

`service remove` is renamed `service delete` (result field `removed` becomes `deleted`; `SERVICE.REMOVE_FAILED` becomes `SERVICE.DELETE_FAILED`), and every service command that targets an existing service now requires `--service` or `PRISMA_SERVICE_ID` — the interactive picker and the remembered selection are gone, and `--branch` no longer falls back to the local git branch.
