# S2 — Platform family port (slice overview)

S2 ports the platform CLI onto `@prisma/cli-engine` and retires the
commander shell. It ships as FOUR stacked PRs, split by area, each its
own contract + dispatch plan, each ≥1k LOC (operator floor, applies to
the port PRs; infrastructure PRs may be smaller where inherently so):

| PR | Contract | Content |
| --- | --- | --- |
| S2a | `s2a-foundations.md` | Engine publishable + production dep; `ctx.api`; auth module extraction; the credential manager + the `auth *` family on it; update check; telemetry package move + wiring; clack prompt renderer |
| S2b | `s2b-resources.md` | `project *`, `postgres *` (database), `bucket *` (incl. keys), `branch list` |
| S2c | `s2c-services.md` | `service *` (renamed from `app`, incl. env + domain subgroups), `build *`, `git *`, `agent *`, `feedback` |
| S2d | `s2d-init-and-retirement.md` | `init` wizard; commander-shell deletion; fixture-mode machinery deletion; final parity review |

Branch mechanics: each PR branches off `main` (S1 merged as PR #129)
and lands into `main`. S2b depends on S2a; S2c on S2b; S2d on S2c.

## Standing rulings that govern every S2 PR

All operator-ruled; none are open to implementer judgment.

1. **Vocabulary**: the contribution/ownership entity is `CommandFamily`
   (never "product"/"manifest"; `commandFamily`/`commandFamilies` never
   shortened in identifiers). A subgroup is owned by exactly one
   command family. `project` belongs to the platform family; Composer
   parks under a `composer` root in S3 (TML-3189 holds the final
   grammar).
2. **Renames**: the deployable-unit noun is Service — the `app` group
   ports as `service` (S2c). No other renames are ruled.
3. **Types**: no conditional properties on stored types — `define*`
   inputs may be optional, normalized definitions are total (`T |
   undefined` or a natural empty).
4. **Testing**: semantic-first. Commands are tested through
   `createTestCli` (`@prisma/cli-engine/testing`) with the management
   API faked at `ctx.api` and sessions seeded into the harness's
   in-memory credential manager (state read back after the run).
   Assertions target the envelope, presented data, events, and exit
   codes — NOT output bytes. A single small golden suite per output
   surface pins human rendering and channel discipline globally.
   Fixture-mode tests are deleted batch-by-batch as their commands
   port; no fixture machinery survives S2d.
5. **`ctx.api`**: the management API client lives directly on
   `CommandContext` (operator: no extension mechanisms — this is
   Prisma's engine). Spec in S2a.
6. **Auth**: an internal module (`packages/cli/src/auth/`), not a
   workspace package, holding the credential manager behind the
   engine's `CredentialManager` SPI. Sessions are per-workspace, one
   current; the `auth *` commands keep their legacy names. Spec in
   S2a, design in `../assets/engine/credential-manager-design.md`.
7. **Telemetry is essential**: this CLI reports exactly the way the
   ORM CLI does today; the `@internal/cli-telemetry` implementation
   moves to this repo (prisma/prisma retires it with its CLI at S5).
   Spec in S2a.
8. **`--trace` is dropped** (log levels cover it). The update
   notification is ported in S2a (not deferred).
9. **Prompts**: interactive rendering is backed by `@clack/prompts`
   1.5.0 (exact-pinned, fully internal, prompts only — never its
   spinners; progress stays engine events). Spike-verified
   (2026-08-10); landing spec in S2a.
10. **Parity**: divergences from the shipping CLI are enumerated per
    PR in a divergence list for operator review, not discovered.
    Maintainability outranks byte parity.

## Grounding inventory

`assets/s2/command-inventory.md` catalogues every current command
(flags, positionals, auth requirement, API calls, behavior class,
output, prompts, side effects, tests, engine mapping). S2b–S2d
contracts enumerate their commands FROM that inventory; the inventory
is the single source for "what exists today".

## Open questions for the operator (S2 ledger)

**All remaining questions RATIFIED at their stated defaults by the
operator's S2 sign-off, 2026-08-12** (Q6's final URL is still owed as
follow-up work; the interim URL ships). The entries stay below as the
record of what each default was.

Contracts build to the stated default where one is given; the ruling
can overrule before the affected dispatch runs.

- **Q1 — auto-login.** ~30 legacy commands auto-launch interactive
  OAuth on a TTY when unauthenticated; the engine's `needs.credentials`
  fails early instead. Default built to: sign-in structured error +
  `auth login` nextAction (consistent, agent-friendly). Ratify or
  reinstate auto-login as an engine feature.
- **Q2 — `service run`. RULED (operator, 2026-08-11): dropped.** It does
  not port. The command started a local dev server and passed its exit
  code through, which is Composer's `dev`. Nothing of the commander
  shell survives S2d on its account, and the removal joins the divergence
  list alongside `service build` and `service deploy`.
  **Corrected at S3 closure (D4):** this row used to add that the engine
  does not grow a child-exit-code passthrough, and S3 built one —
  `ctx.spawn` plus the `exitWithChildStatus` settlement, for composer's
  converge. So the mechanism exists and the command does not, which is
  the opposite of the reading S3 was once planned around ("S3 closes Q2
  by building the mechanism"). Q2 stays closed by main's #135, which
  dropped the command outright; anything that ever revives it rides the
  mechanism that is now there.
- **Q3 — `project env remove`'s `rm` alias** (the only alias in the
  tree) does not port. Ratify the drop or rule alias support.
- **Q4 — reading the config file from the shipped binary. RULED (operator, 2026-08-11): copy prisma/prisma and prisma/composer, which both use `c12`.** Our loader does a plain dynamic `import()` of `prisma.config.ts`, which only works under a TypeScript-capable runtime; the shipped binary runs on ordinary Node. Both reference repositories solved this already and identically, so there is nothing to design. `c12` is a dependency, imported dynamically at the call site, invoked as `loadConfig({ name, cwd, configFile? })`. See `packages/1-framework/3-tooling/config-loader/src/load.ts` in prisma/prisma, and the `cli` and `composer` packages in prisma/composer. One ordinary `dependencies` entry is the whole contract: `c12` evaluates TypeScript through `jiti`, which `c12@3.3.4` depends on directly, so installing `c12` installs the part that makes it work on plain Node. `c12`'s only peer dependency is `magicast`, and that one is optional.
- **Q5 — exit-code unification.** R-S2b-3 changes user-visible codes:
  legacy consent failures split 1/2 and prod-deploy cancel exits 0;
  engine rules make these 2 (structural) and 3 (cancel). Built to
  engine rules; ratify.

Added during the S2a review loop (2026-08-10, built to the stated
defaults):

- **Q6 — telemetry docs URL.** The first-run disclosure and telemetry
  help need this CLI's real telemetry docs page; interim: the existing
  prisma.io CLI docs URL. Supply the final URL.
- **Q7 — telemetry config enrichment dropped.** The ORM sender
  evaluates `prisma-next.config.*` (c12, arbitrary TS in a detached
  child) for two wire fields; dead in this product, so the port drops
  the load — `databaseTarget` null, `extensions` empty. Ratify, or
  rule a `prisma.config.ts`-based replacement (interacts with the
  config-loading ruling above).
- **Q8 — disclosure timing.** Events fire at settlement (`onSettled`,
  per contract); the first-run privacy disclosure prints pre-run so
  users learn before output, but crashed/killed runs emit nothing
  (the ORM's preAction timing emitted before the command). Ratify.

## Definition of done (whole slice)

- Every platform command runs on the engine; the commander shell and
  fixture machinery are deleted; `prisma-v8` naming is retired in
  favor of the real bin wiring (final naming ruled in S2d).
- Per-PR divergence lists reviewed by the operator.
- Engine published and consumed as a production dependency.
- Telemetry reporting live with the ORM-identical client and shared
  installation id.
