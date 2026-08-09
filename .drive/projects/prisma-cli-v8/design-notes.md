# cli-host — design notes

Orchestrator-authored index of the settled design inputs this project
builds on. The artifacts themselves live where they were produced; this
file is the map.

## Settled (do not re-litigate without the operator)

- **Engine interface, v8** — `assets/engine/engine-interface-draft.ts`.
  Settled through facilitated line-by-line design with Will plus five
  adversarial review rounds (architect + principal engineer, both
  closed clean). Every novel typing claim compile-verified; the claims
  live on as the permanent type-test suite in `@prisma/cli-engine`
  (review artifacts and superseded draft versions are not committed).
- **Requirements R1–R14** — prisma-cli PR #128
  (`docs/architecture/cli-engine-requirements.md`), unmerged.
- **Packaging** — ONE library package `@prisma/cli-engine` with a
  `./protocol` subpath for types-only consumers; `@stricli/core` as an
  ordinary exact-pinned dependency (bundling rejected); committed
  versions, bumped in PRs.
- **Model** — commands settle like promises: COMPLETED (presented
  outcome: data + diagnostics + documented exitCodes) vs ERRORED
  (structured error, engine-rendered). `Diagnostic` ≡ the error envelope
  shape; findings are data, never thrown.
- **Framework decision record** —
  `assets/engine/stricli-vs-clipanion.md` (stricli 10/10 vs
  clipanion 7/10 on the repo's own rubric).
- **Evidence base** — `assets/engine/output-modes-survey.md`
  (~85 commands, three families, mode taxonomy, recurring structures).
- **Auth** — an auth library (token storage, refresh, login guts) lives
  in the prisma-cli repo, DISTINCT from Prisma Cloud; Cloud extraction
  later leaves auth behind. `{ token }` is the engine-visible shape;
  credentials resolve per-call so refresh works under long sessions.
- **Conformance** — a small 3-check tool only: import purity, validator
  no-throw on garbage, published-tarball verification.
- **ADR 239 amendment (prisma/prisma) is an implementation
  prerequisite** — completed-but-unsuccessful results carry dotted codes
  as diagnostics inside completed envelopes; includes the
  severity-'info' evidence check (trim both scales together if unused).

## Parked (excluded from this project by ruling)

- **Daemon library** — `assets/engine/daemon-library-notes.md`:
  runtime dependency of product control clients, orthogonal to the
  engine; zero engine surface needed.

## Hand-off briefs — handed off, PAUSED by the operator

- `assets/briefs/1b-leftovers-prisma-prisma.md` and
  `assets/briefs/1c-leftovers-composer.md` are already with other agents,
  but the operator paused that work until the engine lands: their config
  deliverables (diagnostics-not-throw loaders, marker, validators) will
  be rewritten against the engine's config API (v8 §3:
  defineConfigSection tokens, validator-owned absence, Diagnostic
  findings, CommandFamily). Sequencing consequence: the engine's
  protocol + config-section API is upstream of resuming 1b/1c; when
  resumed, the briefs need revision first.

## Prior art / superseded

- The consolidate-clis project (closed 2026-08-07): grammar doc, spec,
  plan recoverable from prisma/prisma PR #29917's head ref
  (`refs/pull/29917/head`). Its Phase 2–3 content (host build, ports,
  ecosystem cutover) informs this project's plan but was never
  re-ratified — treat as input, not contract.
