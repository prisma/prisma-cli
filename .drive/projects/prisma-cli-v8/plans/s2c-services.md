# S2c dispatch plan — services

Contract: `../specs/s2c-services.md`. Branch `s2c-services` off `main`
after S2b merges. Standing rules as in S2b's plan.

> **Executed, with three commands removed by operator ruling after the
> dispatches ran.** The dispatch scopes below are kept as the record of
> how the work was actually divided; they are not the shipped scope.
> `service deploy` and `service build` are **dropped** — they conflated
> local compiling with uploading a tarball, Composer supersedes them,
> and they are not coming back in that shape. `service logs` is
> **shelved**, not dropped: it needs an authenticated WebSocket the
> engine cannot yet open, and returns in S8
> (`../assets/engine/websocket-transport-design.md`). `service run` was
> already ruled dropped. The slice ships **17 commands**; the divergence
> file is the accurate list.

### D1 — service group core (rename included)
`service build|show|open|list-deploys|show-deploy` + `service domain
add|show|remove|retry|wait` — sync/poll commands first, establishing
the renamed group and the S2b template in this codebase area.

### D2 — progress operations
`service deploy|promote|rollback|remove` per R-S2c-3 (step/progress/
status event sequences, SDK polling on the injectable clock, consent
on remove).

### D3 — streams
`service logs` + `build logs` per R-S2c-2 (session commands, output
events, channel routing; `build logs` gains its first tests).

### D4 — agent + feedback + closure
`agent install|update|status`, `feedback`; divergence list; legacy
fixture-test deletion for ported groups; review loop; PR. `service
run` stays parked unless ledger Q2 was ruled — if ruled "S2c", it
becomes D3b per the ruling's mechanism.

Completeness: D1→sync surface; D2→progress; D3→streams; D4→closure.

### What actually shipped

D1's group core, minus `service build`; D2's progress operations, minus
`service deploy`; D3's `build logs` only, with `service logs` shelved;
D4 whole. `service run` never ported.

Two of D4's closure items diverge from the plan deliberately, both
recorded in the review ledger: the legacy fixture tests were **not**
deleted, because the commander shell still serves those commands until
S2d removes it, and the fixture-deletion decision is with the operator;
and the PR opens against `s2a-foundations` rather than `main`, because
that branch is where the engine and auth foundations this slice builds
on still live.

That second item was written when the branch carried no merge-down from
its base. It has since taken three, the last of them `dc44f75`, which is
how the rev-6 credential surface reached this slice; the merge review
that followed is recorded in the review ledger.
