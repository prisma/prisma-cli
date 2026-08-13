# ADR 0004 - Resources live on branches, a deploy produces a Version, and every surface speaks one language

## At a glance

One config file declares the system. Deploying it on a branch creates that
branch's own copy of every declared resource:

```text
git branch: main                        git branch: pr-123
config declares service "web"           same file via git, plus new "worker"
        │  deploy                               │  deploy
        ▼                                       ▼
Branch: main                            Branch: pr-123
└── Service web                         ├── Service web        ← same key, so
    └── Version 14   (live)             │   └── Version 1        "the same service";
                                        │                        a different
                                        └── Service worker       platform resource
                                            └── Version 1
```

Everything in this ADR is visible in that picture. The two `web` rows are
two platform resources — branches are isolated environments — and what makes
them the same service is the shared key `web`, declared in one config
lineage and carried between branches by git. `worker` exists only where its
declaration exists. Each deploy produced a **Version**: one immutable build
of a service, which is also the thing traffic is promoted to or rolled back
to. And each deploy left behind a record of itself — a **Build Run** —
saying what it built and touched. The rest of this document narrates that
picture, one idea at a time.

## Status

Proposed

## Context

Three surfaces are converging on the platform's nouns at once: the unified
CLI's command grammar, the Console, and the boundary between the platform API
and Composer (the TypeScript framework that declares and deploys a
multi-service application). Each has been improvising its own answers to the
same questions — what contains what, what makes a service on two branches
"the same" service, what a deployment is, and what record explains how a
resource came to exist. This ADR fixes one answer to each, for all three
surfaces. It amends `docs/product/resource-model.md` where the two disagree;
that document remains the living reference and is to be revised to match.

## Decision

Adopt the model the at-a-glance example shows, as the single domain model
for the API, the Console, and the CLI: every runtime resource lives under a
Branch, cross-branch identity is the declared config key, a deploy produces
a Version, every orchestrated run is recorded by a Build Run, and the
evaluated graph is a branch-level Topology record.

The full containment hierarchy:

```text
Workspace
├── Project
│   └── Branch
│       ├── Service
│       │   ├── Version
│       │   └── Domain
│       ├── Postgres Database
│       │   ├── Connection
│       │   └── Backup
│       ├── Bucket
│       │   └── Key
│       ├── Deploy state store
│       └── Topology              (optional — the declared graph)
└── Build Run
    └── Build Resource            (links to the resources and versions
                                   the run touched)
```

Containment means Prisma manages the resource's lifecycle. External
resources a config references but does not own are linked and shown in
plans — never contained, never deleted by Prisma. The contract (the data
model) is code in git, not a platform resource; the platform sees only its
consequence, the migration marker on each database.

### Identity: branch-scoped, with the config key crossing branches

A service created on one branch exists only on that branch. There is no
project-level service registry: cross-branch identity is the declared config
key, as the example shows. This is how the platform schema already behaves
(services and databases are branch-scoped; names are unique per branch, not
per project) and how Composer already defines a node's identity — the
**deploy address**, its hierarchical position in the declared graph. Within
a branch, resources keep stable platform IDs.

The rule generalizes: anything anyone wants to say about a service *across*
branches — service-scoped variables, a cross-branch view in Console, a
domain that follows a service to production — is a statement about the
config key, which is well-defined because the key comes from one config
lineage.

The accepted cost is rename. Under config-key identity, renaming `web` to
`web-api` in the config is indistinguishable from "delete `web`, create
`web-api`": each branch's next deploy plans a creation plus a destructive
deletion — always listed, always confirmed, never quiet. Making rename a
first-class operation requires an explicit config annotation ("the resource
formerly at this address"); the model is incomplete until that affordance
exists, and until then a rename is exactly that planned delete-and-create.

This amends the prior identity rule ("renaming or moving code never creates
a new resource", the Unified CLI plan's invariant 13) to: stable IDs hold
within a branch; across branches, identity is the declared key.

### A deploy produces a Version

**Deploy** is a verb in this model, never a noun. What it produces is a
**Version**: one immutable build of a service together with its runtime
instance — it has an artifact, a status, logs, a URL, and can be started and
stopped. Traffic actions read naturally against it: promote a version, roll
back to a version.

The word "Deployment" is retired, and this is not a new word imposed on the
platform — it is the API catching up to its own schema. The control plane's
"Deployment" is a database table named `ComputeVersion`, the runner's record
of it is a version, and Promotion already exists as its own entity pointing
at a version. The rename is one clean cut across every surface — API paths,
Console, CLI grammar, JSON fields, error codes — with no aliases, because a
platform that says "version" in one surface and "deployment" in another is
worse than either word.

The rename also pays for a bug fix. The service field previously called
`latestDeploymentId` actually meant "live". The model records the **newest**
version and the **live** version as two separate facts with two names.

### The four layers, and drift

Composer evaluates the config into a graph of declared resources and the
bindings between them, then **converges**: it compares that graph against
what exists and creates, updates, or removes resources until reality
matches. Four layers fall out of that, each with exactly one owner and one
writer:

```text
prisma.config.ts  →  Topology           →  Deploy state        →  Reality
source (in git)      evaluated intent,     what the last          what the platform
                     serialized            converge recorded      holds right now
```

The **Topology** is the serialized, evaluated graph, stored as a first-class
child of the Branch: nodes (modules, services, databases, buckets) keyed by
deploy address, plus binding edges. Only config evaluation writes it —
evaluation is side-effect-free, so the record can never claim anything the
config didn't. Deploys converge from the root, the whole graph every time,
so the topology is always total. It is optional, and absence is meaningful:
a branch with no topology is a branch nobody orchestrates. It cannot be
derived from the **deploy state store** — the provisioning engine's own
branch-scoped record — because that store holds the *lowered* form (the
provider-level resources the graph was translated into), and the translation
is lossy. The semantic graph is stored as itself, a versioned serialization
contract alongside the config, the provider protocol, the structured output,
and the deploy state.

Direct resource commands keep working on orchestrated branches, so two
things are true by design. Presence is not coverage: resources can exist
that no topology node declares, and the topology describes only the
orchestrated and referenced subset — "on this branch but not in the graph"
is itself a useful state (the list of candidates for adoption into the
config). And topology-vs-reality drift is permanent: the model promises
drift *visibility*, never prevention. The plan is the reconciliation of the
four layers, and because both sides of the comparison live on the platform
for Prisma-owned resources, drift is computable server-side — no CLI run
required.

### Build Runs: provenance for everything

A **Build Run** is a workspace-level record of one orchestrated run — a
converge in the user's CI, a laptop deploy, a Console action. It is purely
informative: the platform never executes user code, so the record reports
work done elsewhere and is exactly as trustworthy as the reporter it names
(the writing credential, plus a link to the CI workflow run where one
exists). It is scoped to the Workspace because a first deploy can create the
very project it targets — no container below Workspace is guaranteed to
exist when the record is born.

Every deploy writes one, laptop runs included, so every Version has
provenance; CI and laptop differ only in a `source` field. Its **Build
Resource** links point at what the run touched and, where one exists, at the
immutable thing produced — per-link outcomes, so a run that created two
services and failed on the third says exactly that. Runs reference the
topology revision they acted against: audit points at structure, never the
reverse. And Build Runs outlive what they link to — deleting a project does
not erase its build history; links are dangling-tolerant in the schema.

### The ubiquitous language

The words every surface uses — API, Console, CLI, docs, and code:

| Term | Meaning |
| --- | --- |
| Workspace | The account, membership, and billing boundary. |
| Project | The remote container for one application. Owns branches. |
| Branch | The named, isolated environment inside a Project. Every runtime resource belongs to exactly one. Production is the default branch, distinguished by role, never by name. |
| Service | One deployable workload on a branch. |
| Version | One immutable build of a service together with its runtime instance. Produced by a deploy. |
| Deploy | The verb. Deploying produces a Version. |
| Promote / Rollback | Traffic actions on a service: point its stable endpoint at a version. |
| Newest version / Live version | Two separate facts about a service. "Latest" is banned: it conflated them. |
| Domain | A hostname attached to a service on a branch. |
| Postgres Database | A Prisma-hosted database on a branch, with Connections (credentialed endpoints) and Backups. |
| Bucket | Branch-scoped object storage, with access Keys. |
| Deploy state store | The provisioning engine's branch-scoped record of what the last converge created. Lossy relative to the Topology. |
| Topology | The serialized, evaluated graph for a branch. Optional; absence means the branch is not orchestrated. |
| Deploy address | A node's hierarchical position in the declared graph. A node's identity; names are diagnostics. |
| Build Run | The workspace-level, purely informative record of one orchestrated run. |
| Build Resource | One link from a Build Run to a resource or version it touched, carrying that link's own outcome. |
| Orchestrated / Direct / Referenced | The three ways a resource participates: declared in config and converged; created and managed through resource commands; declared but managed elsewhere. |

Retired or banned on user surfaces: **Deployment** (the noun),
product-qualified nouns (**Compute Service**), implementation names
(**Alchemy**), `latestDeploymentId`, and the bare word **version** — always
qualified as service version, database version, or config version.

### Reserved terms

Reserved so nothing unrelated is designed under these names; neither is
built:

- **Database Version** — the segment of a database's lifetime spent on one
  contract, beginning when a migration lands, anchored to the migration
  marker. With point-in-time backups this composes into a two-axis restore
  (version + time); restore forks rather than mutates, keeping migrations
  forward-only.
- **Subgraph deployment** — deploys converge from the root, full stop. If a
  scoped converge is ever built: scope is a deploy-address prefix taken
  forward through the graph (pulling backwards through shared dependencies),
  deletion detection applies only within scope, and cross-boundary staleness
  must be surfaced, never silently left behind. Evaluation stays total even
  when convergence is scoped, so the topology remains complete.

## Consequences

- The Deployment → Version rename lands on every surface in one aliasless
  cut, or not at all.
- A Version is both the immutable revision and its runtime instance;
  start/stop and scaling surfaces are designed against that definition, not
  against "version = pure artifact".
- Until the rename affordance exists, renaming a config key is a planned,
  confirmed delete-and-create on every branch.
- Console must not treat the Topology as the complete map of a branch, and
  must expect branches with no topology at all.
- The topology serialization becomes a public, versioned contract the moment
  anything outside Composer consumes it.
- Every Version is traceable to a Build Run; build history survives the
  deletion of everything it describes.
- `docs/product/resource-model.md` and ADR 0002's noun list are amended
  where they disagree with this model.

## Alternatives considered

- **Project-level service identity with per-branch instances.** Rejected:
  it adds a registry and an instance noun the schema doesn't have, couples
  branch isolation to project-level state, and contradicts how Composer and
  the platform already work. The config key gives cross-branch identity
  without either.
- **Keeping "Deployment".** Rejected: the schema already says
  `ComputeVersion`, and the verb/noun near-collision ("deploy the
  deployment") reads badly next to promote/rollback.
- **Deriving the Topology from the deploy state store.** Rejected: lowering
  is lossy; the semantic graph cannot be reconstructed from the lowered
  provisioning records.
- **Attaching topology snapshots to Build Runs instead of the Branch.**
  Rejected: it makes structure reachable only through an entity defined as
  informative and unreliable. Audit points at structure, never the reverse.
- **"Build Job" at any scope.** Rejected: a job is something a system
  schedules and owns; this platform records runs it never executes, and
  "job" inverts GitHub Actions' own run/job hierarchy.

## Related

- `docs/product/resource-model.md` — the living reference this ADR amends.
- ADR 0002 — workflow command model; its noun list is amended by this ADR.
- ADR 0003 — structured output and errors.
- Composer ADRs 0003 (deploy derives everything from the root), 0006
  (identity is the deploy address), 0034/0045 (deploy state branch-scoped,
  behind the platform state API).
