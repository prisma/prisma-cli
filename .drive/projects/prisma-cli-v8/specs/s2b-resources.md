# S2b — Resources (slice contract)

One PR into `main`, branch `s2b-resources`, after S2a merges. Ports the
resource-administration groups onto the engine: `project *` (incl.
`env`), `postgres *` (renamed from `database`, incl. `backup` and
`connection`), `bucket *` (incl. `key`), `branch list`, `git *`.

Normative sources, in precedence order: (1) this contract's mapping
rules and per-command decisions; (2) the command inventory
`../assets/s2/command-inventory.md` for every current-behavior fact
(flags, positionals, API calls, output shapes, prompts, side effects)
— port behavior is the inventory's record EXCEPT where a mapping rule
below changes it, and every such change is a divergence-list entry;
(3) the v8 draft. Unpinned fact → STOP, never improvise.

## Mapping rules (apply to every command in this PR)

R-S2b-1 **Rename**: the `database` group ports as `postgres`
(target grammar). All paths, help, ids (`postgres.connection.rotate`),
and docs update; no alias to the old name. Divergence entry.

R-S2b-2 **Auth**: every command the inventory marks `platform` or
`platform+login` declares `needs.credentials`. The legacy
auto-launched interactive OAuth login (`platform+login`) DOES NOT
port: unauthenticated invocations settle with the engine's sign-in
error and a `run-command` nextAction for `auth login`. (Operator
ratification pending — morning-questions ledger Q1; build to this
rule unless overruled.)

R-S2b-3 **Consent**: destructive operations (`remove`/`delete`/
`restore`/`rotate`/`transfer` — exactly the inventory's
"needs --confirm"/consent rows) keep their CURRENT confirmation flag
(name and value semantics per inventory, e.g. exact-id `--confirm
<id>`); interactively, absent the flag, they use `prompt.consent`
with the inventory's current question text. Non-interactive without
the flag → the engine's `CLI.CONSENT_REQUIRED` (exit 2). Cancel →
exit 3. The legacy split (exit 1 vs 2 vs 0-on-cancel) unifies to
engine codes; each changed code is a divergence entry.

R-S2b-4 **Secrets**: commands the inventory marks "secret on stdout"
(`postgres create`, `postgres connection create|rotate`, `bucket key
create`) present the secret as the `stdout` payload lines (pipe-clean
by Option A) and mask it in human Blocks via `sensitive: true`. The
json envelope carries it in `result` exactly as today.

R-S2b-5 **Errors**: legacy flat codes map to dotted codes under the
group's namespace (`PROJECT.*`, `POSTGRES.*`, `BUCKET.*`, `GIT.*`,
`BRANCH.*`), preserving summary/why text; every mapping is enumerated
in the divergence list. Errored paths exit 2 (legacy 1 → 2
divergences enumerated once as a class).

R-S2b-6 **Interactive pickers** (`project link`, others per
inventory): `prompt.select` (clack path) with the inventory's option
labels; non-interactive without the disambiguating arg → structural
prompt failure.

R-S2b-7 **Polling** (`git connect` install wait): result command
emitting `status` events per poll transition, engine-clock injectable;
timeout behavior per inventory.

R-S2b-8 **Aliases**: `project env remove`'s `rm` alias does not port
(the tree has exact paths; it is the only alias in the shell).
Divergence entry. (Ledger Q3.)

R-S2b-9 **Tests**: semantic per the S2 ruling — `ctx.api` faked with
recorded SDK-shaped responses; every command × (success, errored,
json envelope, unauthenticated, consent grant/deny/non-interactive
where applicable, picker path where applicable). No fixture mode. Each
command's test asserts envelope + presented data + events + exit code,
not bytes.

R-S2b-10 **Files**: v8 command modules live at
`packages/cli/src/v8/<group>/<command>.ts`, one command per file,
definitions + handler colocated (S1 whoami pattern); shared per-group
presentation helpers in `packages/cli/src/v8/<group>/presentation.ts`.
Handlers call the existing controllers'/providers' operation layer
(inventory names the exact functions) — S2b does NOT rewrite the
operations, only re-homes invocation behind `ctx.api`-built clients
where the operation takes an SDK/client argument (inventory's "API
surface" column names it).

## Commands in scope (31)

`project list|show|create|link|rename|remove|transfer`,
`project env add|update|list|remove`, `git connect|disconnect`,
`branch list`, `postgres list|show|create|usage|restore|remove`,
`postgres backup list`,
`postgres connection list|create|rotate|remove`,
`bucket list|create|delete`, `bucket key list|create|delete`.

Every command: one inventory entry = its behavior contract; the
mapping rules above are the only deltas. The implementer builds a
per-command conformance row (command → inventory entry → applied
rules → divergences) in the PR's divergence list.

## Out of scope

`service`/`app`, `build`, `agent`, `feedback` (S2c); `init`, shell
deletion (S2d); auto-login reinstatement (ledger Q1); command aliases
(ledger Q3).

## Acceptance

- [x] All 31 commands mounted in the v8 bin under groups
      `project`, `git`, `branch`, `postgres`, `bucket` (+ declared
      subgroup help), passing R-S2b-9's test matrix. The mount-coverage
      test now asserts the literal path list, so a missing command
      fails it.
- [x] `postgres` rename complete; no `database` path survives in v8.
      The three v8 strings that named the old group and left the error
      mapper's regex to rewrite them were found by the closure pass and
      now name `postgres` directly.
- [x] Consent matrix proven for every destructive command — all seven,
      each matrix non-vacuous, with the success case driving a real
      API call.
- [x] Secrets pipe-clean and masked per R-S2b-4. The golden entry added
      at closure is what joins our `sensitive` flag to the engine's
      `********`; before it, neither end proved the other.
- [x] Divergence list updated, 46 entries and a conformance row for
      every command.
- [x] Legacy fixture tests for ported commands deleted, unit tests for
      helpers and providers the new commands still call kept; legacy
      shell still green for unported groups.
- [x] Root verification green; PR #133 at roughly +17,700 lines; both
      the per-dispatch review rounds and the closure architect and
      principal-engineer passes run, with every finding dispositioned.

Three things this slice records rather than fixes, all for the operator:
`project list` reports an empty workspace at exit 0 when the API
rejects the request, which is inherited from the old shell and reaches
every command that resolves a project by name; `git connect`
declares `needs.interaction`, so non-interactive runs fail before any
API call even when no wait would have been needed; and the stdout lane
still carries two human-formatted values that a pipe consumer cannot
use — a backup size as `2.0 KiB` and a status column that holds
`isDefault` when the status is null. The decorated-key case that
prompted the check is fixed; these two are a broader question about
whether stdout is a machine lane or a mirror of the human table, which
reaches every group and wants deciding rather than patching.
