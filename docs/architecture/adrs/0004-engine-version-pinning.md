# ADR 0004 - One engine per install: peers on product CLI packages, engine-free libraries

## Status

Accepted (operator, 2026-08-13). One sub-decision remains open and is marked below.

## Context

The unified CLI is assembled from packages published by three repositories: this repo publishes the shell (`@prisma/cli`) and the engine (`@prisma/cli-engine`); the composer and prisma/prisma repos each publish a command-family package the shell mounts. The engine must exist exactly once in any installed tree that runs the CLI: families construct their command objects with the engine they resolve, the shell executes them with the engine it resolves, and while structured errors deliberately survive two copies (`Symbol.for` markers, test-pinned), execution and signal behaviour across copies is unsupported by ruling.

Under the original arrangement — every family carrying the engine in `dependencies` with an exact pin — that invariant held only when every published pin agreed exactly. It failed in practice: at the time of this decision, installing `@prisma/cli` resolved **three** engine copies (the shell's, plus one each dragged in by `@prisma/composer` and `@prisma/orm-toolchain`, both pinning an older engine). The conformance checker (S6) reports this at publish time, but pins can only detect the problem in trees we publish; nothing prevents npm from assembling a duplicated tree from versions that individually looked fine. Two further costs: every engine release forced a four-repo republish train (engine → composer → prisma/prisma → shell) even for releases that did not change the engine, and applications depending on `@prisma/composer` as a *library* installed an engine copy their code never imports, because the library and the command family shared one manifest.

## Decision

The dependency tree the strategy targets:

```text
app
├── prisma CLI (@prisma/cli)          the one binary users run
│   ├── @prisma/cli-engine            dependencies, exact — the single real engine
│   ├── @prisma/composer-cli          dependencies, exact
│   │   └── @prisma/cli-engine       peerDependencies, exact
│   └── @prisma/orm-toolchain         dependencies, exact
│       └── @prisma/cli-engine       peerDependencies, exact
├── @prisma/composer                  library; NO engine relationship
└── @prisma/orm-postgres              library; NO engine relationship
```

Per edge:

1. **app → CLI**: the user's ordinary semver choice. The CLI is an application: a given CLI version fully determines its tree, so `npx prisma@<v>` is reproducible.
2. **shell → product CLI packages**: exact pins in `dependencies`. A range here would let the CLI's behaviour change on the registry without a shell release.
3. **product CLI packages → engine**: an **exact `peerDependency`** (plus a `devDependency` at the same version for the package's own tests). The shell supplies the one engine that satisfies every peer. Peers resolve against the ancestor, so exactly one engine exists in any tree shape npm can assemble, and a version conflict is an **install-time error** rather than a silent second copy.
4. **product libraries**: no engine relationship of any kind. Applications depend on libraries; only the CLI depends on product CLI packages; product CLI packages reach applications only transitively through the CLI.

**Consequence for packaging:** a product may not mix its application-facing library and its command family in one published package, because a peer on the combined package would be auto-installed for every library consumer. The ORM already conforms (`@prisma/orm-toolchain` is dev/CLI-only; applications reach its vite plugin through `@prisma/orm-postgres`'s forwarded export). Composer splits: `@prisma/composer-cli` takes the family, the testing surface and the bin; `@prisma/composer` keeps the library exports and drops the engine entirely. The import graphs were verified disjoint before the split was scheduled, so it is a packaging change, not an untangling.

**Exact now, range later.** During the rc line the engine breaks its consumers deliberately, slice by slice, so a version range would be fiction. Post-GA, the recorded destination is widening the peers to a range under a written engine compatibility contract, so a non-breaking engine release ships in the next shell release with zero family republishes. Widening is a deliberate future decision against that contract, not a drift.

**OPEN — engine versioning.** Today the engine versions in lockstep with the shell (`8.0.0-rc.N`), which manufactures a family-repin obligation out of every CLI release whether or not the engine changed. The proposal on the table is to version the engine independently, bumping only when it changes. This reverses part of the lockstep ruling and awaits the operator's decision; nothing in this ADR depends on it except the *frequency* of the repin train.

## Enforcement

The conformance checkers in both publishing repos are the mechanism, evolved from pin-equality to this strategy:

- **Peer satisfaction**: the shell's engine version must satisfy every mounted family's engine peer. Replaces pairwise pin comparison.
- **Singleton install**: the packed shell tarball, installed into a clean sandbox, resolves exactly one engine copy — with **no exception list**. Under peers a mismatch fails at install, so the S6-era recorded exceptions are deleted the moment the first tandem release lands the peers.
- **Engine-free libraries**: a library package's packed output names the engine in no import and in no consumer-installed dependency field.

## Cases considered

- *User installs the CLI alone* (global, `npx`, devDependency): peers guarantee one engine regardless of how the package manager arranges the tree.
- *App depends on a product library and the CLI*: the library carries no engine, so no duplication is possible through that route. This case was unsolvable under `dependencies` pinning and is the reason peers plus the split were chosen.
- *Release skew between the component repos*: an unsatisfied exact peer fails at install/publish-check time instead of shipping a duplicated tree; the open versioning decision above governs how often skew windows occur at all.
- *Two CLI versions in one monorepo*: nested and isolated; each tree satisfies its own peers.
- *CLI ↔ library version skew* (the app's `@prisma/composer` vs the CLI's `composer-cli`): explicitly **not** a duplication problem and not addressed here; it is a compatibility-policy question (support floor or runtime detection) that needs its own owner.

## Alternatives considered

- **Exact pins in `dependencies` everywhere (status quo ante).** Detects duplication only in published combinations; silent duplication in assembled trees; maximal republish train; forces an engine install on library consumers. Rejected on the library case alone, which no amount of pin discipline can fix.
- **Range peers immediately.** Removes the train now, but promises compatibility the rc-line engine deliberately does not offer; a family built against engine N running against engine M is exactly the untested-across-copies behaviour the invariant exists to avoid. Deferred, not rejected.
- **npm `overrides` guidance for affected users.** Overrides work only at the application root and shift the burden to every consumer. Not a strategy.
