# S3 dispatch plan — Composer adoption

Contract: `../specs/s3-composer.md`. Two repos. prisma-cli work on
branch `s3-composer`; composer work on a branch created at D2.
Implementers and reviewers on Opus (operator ruling). Standing
process rules as in the S2 plans.

### D1 — the subshell primitive (prisma-cli: engine)
R-S3-1 in full: the `handsOffTerminal` capability + context
affordance, async spawn with inherited stdio, presentation
suspension, signal forwarding (incl. double-SIGINT), credential-
manager-backed env injection, exit-code passthrough, spawn-failure
structured error, `--json` rejection, telemetry, draft amendments,
tests (incl. a real child-process test matrix). No composer
knowledge in the engine — the primitive is generic.

### D2 — composer-side foundations (prisma/composer)
The family export skeleton + the `composer` section projection
(R-S3-2/3): exact-pinned engine dependency; the control-library
config rewrite (diagnostics list, no throwing); the pin-enforcement
scope extension and tarball-externality check; the control-API test
double + conformance check (R-S3-6). This dispatch proves the
cross-repo consumption before any command ports.

### D3 — the four commands (prisma/composer + prisma-cli mount)
R-S3-4/5: deploy/destroy (result + handoff + destroy consent), dev
(session + handoff converges + child-side local-target + signal
ownership), log (emulator stream). Mount under the `composer` root
in prisma-cli; family tests through the double; the import-purity
check on engine-side modules.

### D4 — release glue + closure
R-S3-7 tandem-release workflow additions in both repos; divergence
file; 1c closure with explicit dispositions; S2 ledger Q2 update;
slice review loop (architect + PE) across both PRs; PR descriptions
per the ruled structure.

Completeness: D1 → the engine mechanism; D2 → cross-repo proof +
test infrastructure; D3 → the product surface; D4 → release +
record-keeping. `service run` explicitly does NOT ride this slice.
