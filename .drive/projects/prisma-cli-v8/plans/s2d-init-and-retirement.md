# S2d dispatch plan — init and shell retirement

Contract: `../specs/s2d-init-and-retirement.md`. Branch
`s2d-init-and-retirement` off `main` after S2c merges. Standing rules
as in S2b's plan. R-S2d-3 (bin cutover) is BLOCKED on ledger Q4 —
sequence it last and confirm the ruling before starting D3.

### D1 — init + version
R-S2d-1 and R-S2d-2: the wizard on the engine prompt surface (full
prompt matrix incl. `--yes`, non-interactive, cancel; byte-asserted
templates), the `version` command port.

### D2 — deletions
R-S2d-4's checklist from the inventory: commander shell, fixture
machinery, fixture tests, `--trace`, env surface. Survivor list
enumerated. Legacy suite shrinks to zero fixture tests; everything
remaining is engine-side.

### D3 — bin cutover (after Q4 ruling)
R-S2d-3 per the ruling; tarball smoke on plain Node (`npm pack` →
install into a temp dir → run `prisma-cli --version`, `auth whoami`,
config-bearing command).

### D4 — closure
R-S2d-5 grammar completeness test; R-S2d-6 consolidated divergence
document; review loop; PR; S2 closed in the project plan (health
check + retro trigger per the drive process).

Completeness: D1→wizard/version boxes; D2→deletion boxes; D3→cutover
box; D4→grammar/parity/closure boxes.
