# Prisma 8 CLI rollout plan

Operator-agreed 2026-08-09 (discussion on PR #129). Governs how the
unified CLI reaches npm, from first pre-release through owning the bare
`prisma` name. S7 builds its release pipeline against this plan.

## Names involved

| npm name | Today | End state |
| --- | --- | --- |
| `@prisma/cli` | Platform CLI 3.x, published from this repo (OIDC) | Carries v8 pre-releases under the `next` dist-tag; deprecated at cutover |
| `prisma-next` | Prisma 8 ORM CLI, published from prisma/prisma `main` | Handed off to this repo at S5; rc channel for ORM early adopters; deprecated at cutover |
| `prisma7` | Does not exist yet | The v7-and-under release train's new home, published from prisma/prisma |
| `prisma` | Prisma 7 CLI, published by prisma/prisma's release train | Owned by this repo via OIDC trusted publishing; the unified CLI |

## Sequence

1. **Now → S2 done.** Nothing user-facing ships. Official `@prisma/cli`
   releases are manual-dispatch only and are frozen for the migration;
   the automatic `dev`-tag publish on main merges continues and is
   harmless.
2. **S2 done (platform family ported).** v8 betas publish as
   `@prisma/cli` under the **`next` dist-tag**. This repo already owns
   the name with OIDC; no cross-repo coordination. Semantically honest:
   the first v8 surface is the platform family, i.e. the next major of
   the platform CLI. `latest` stays on the 3.x line throughout.
3. **S5 done (ORM family ported).** The `prisma-next` name is handed
   off: prisma/prisma stops publishing it and its npm trusted-publisher
   config moves to this repo (npm allows one publisher config per
   package, so the handoff is a cutover, not a dual-publish phase — the
   operator owns both repos and sequences it). From then on
   `prisma-next` carries v8 rc builds under a `next` tag. Rationale for
   waiting until S5: `prisma-next`'s installed base is ORM early
   adopters, and the unified CLI cannot serve them before the ORM
   family exists.
4. **`prisma7` ships (owned by the ORM team, timing open).** The
   v7-and-under train moves to the `prisma7` name, freeing the bare
   `prisma` name. This repo configures OIDC trusted publishing for
   `prisma` and publishes `prisma@8.0.0-rc1` under the **`next`/`rc`
   dist-tag** (the S7 pipeline's artifact).
5. **Cutover.** Flipping `prisma`'s `latest` to 8.x is its own
   deliberate manual act, after an rc soak. In the same step:
   deprecation notices on `@prisma/cli`, `prisma-next`, and
   `prisma-composer` pointing at `prisma`, per the grammar/consolidation
   docs. (Codemods and docs-site updates are the ecosystem-cutover
   follow-on, out of this project's scope.)

## Invariants

- Every publish path uses OIDC trusted publishing with provenance; no
  pasted tokens anywhere (a manual-token fallback for prisma/prisma was
  considered and rejected — the `prisma7` rename makes it unnecessary).
- `latest` never moves automatically, on any of the names.
- Version pins across the tandem packages follow the committed-versions
  ruling (S3).

## Open items

- **`prisma7` timing** — owned by the ORM team; blocks step 4 only.
- **`latest`-flip criteria** (step 5) — TBD by the operator; candidate
  inputs: rc soak duration, issue rate, parity-divergence sign-off per
  family.
- **Exact `prisma-next` handoff mechanics** (step 3) — npm publisher
  config transfer + the prisma/prisma workflow change; small, ruled
  feasible since the operator owns both repos.
