# service logs dispatch plan

Contract: `../specs/service-logs.md`. Branch `service-logs` off
`main`. One PR.

## D1 — the command

Outcome: `service logs` mounted and green per the contract — the
S2c resolution logic restored from `bot/s2c-services`, the transport
replaced with the page-read GET, page and follow modes, the full
test matrix on fixtures and the injectable clock. STOP if the pinned
SDK's `query: never` blocks typecheck without a cast.

Builds on: main. Hands to D2: the command green, any SDK blocker
named.

Completed when: contract acceptance items 1–3; gate green
(engine suite, cli suite, typecheck, lint — sequential, exit 0).

## D2 — closure

Outcome: divergence entry, `deferred.md`'s logs entry closes, e2e
backlog entry, review loop, PR. Reconcile with records PR #176's
edit of the same `deferred.md` entry if it has merged.

Completed when: acceptance items 4–6; gate green.
