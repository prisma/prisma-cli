# S2b dispatch plan — resources

Contract: `../specs/s2b-resources.md`. Branch `s2b-resources` off
`main` after S2a merges. Sequential dispatches; each verifies the full
root suite before its commit; standing commit/verification rules as in
`s2a-foundations.md`'s plan. Unpinned fact → STOP.

### D1 — project group
`project list|show|create|link|rename|remove|transfer` +
`project env add|update|list|remove` per contract rules over inventory
entries. Includes the R-S2b-6 picker (`project link`) and two consent
commands. Hands the group-porting pattern (file layout, presentation
helpers, test matrix template) to every later dispatch — this
dispatch's structure IS the template; later dispatches copy it.
Includes a build-time test asserting the command-family maps and the
shell's mount map cover exactly the same command set (no command
mounted without a family entry, none declared but unmounted) — part of
the template every later dispatch inherits.

### D2 — postgres group (rename included)
All 11 database→postgres commands incl. backup + connection; three
consent commands; two secret-bearing (R-S2b-4).

### D3 — bucket + branch + git
`bucket *` (6, one consent, one secret), `branch list`, `git
connect|disconnect` (poll + browser event pattern per R-S2b-7/R-S2c-6
precursor).

### D4 — slice closure
Divergence list (per-command conformance rows), legacy fixture-test
deletion for ported groups, review loop (architect + principal
engineer), findings fixed, PR opened non-draft with the ruled
description structure.

Completeness: D1→project+env; D2→postgres; D3→bucket/branch/git;
D4→closure boxes. Every contract acceptance box maps to exactly one
dispatch.
