# S2c dispatch plan — services

Contract: `../specs/s2c-services.md`. Branch `s2c-services` off `main`
after S2b merges. Standing rules as in S2b's plan.

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
