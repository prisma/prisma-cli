# S8 dispatch plan — service primitives

Contract: `../specs/s8-services.md`. Branch `s8-service-primitives`
off `main`. One PR. Standing rules as in prior plans; the S2b/S2c
command template governs new commands.

Grounding: commands register flat with dotted names in
`packages/cli/src/v8/cli.ts` (`"service domain add"` proves the
subgroup mechanism — a group brief entry plus dotted command keys);
per-command tests are `packages/cli/tests/v8-service-*.test.ts` over
`v8-service-testkit.ts`; the API surface is
`packages/cli/src/lib/app/app-provider.ts`.

### D1 — the `deployment` subgroup + presenter corrections

Outcome: the four renamed commands exist ONLY under
`service deployment` (`list|show|promote|rollback`), and the two
R-S8-3 corrections are in: `deployment show`'s `url` is the promoted
`appEndpointDomain`, and `live` derives from `latestDeploymentId`
alone (the `readKnownLiveDeployment` local-state fallback deleted,
`target.ts:400-448`). Old spellings, ids, help, presenters, test
names all move; nothing answers to `list-deploys`/`show-deploy` or
top-level `promote`/`rollback`. Includes the contract's
placeholder-domain edge case: `service show` presents `live url`
only when a live deployment exists.

Builds on: main. Hands to D2: the subgroup mounted and green — the
registration pattern and corrected provider mappings D2's new
commands sit beside.

Completed when: renamed suites green; a grep for the old spellings
in `src/v8` and help output returns nothing; corrected `url`/`live`
pinned by test.

### D2 — `service list` + `service create`

Outcome: services can be enumerated and born without deploying.
`service list` on `GET /v1/apps`; `service create` on
`POST /v1/apps` with exactly the four create-body fields (name,
project, optional region, optional branch). Provider additions in
`app-provider.ts`; presenters in the established style; `create`
output respects the placeholder-domain edge case (no dead URL
presented as live).

Builds on: D1 (corrected provider mappings). Hands to D3: the
provider's deployment-record plumbing untouched and stable.

Completed when: both commands green through the harness; `create`
proven against the real API in the e2e suite including no-region /
no-branch defaults.

### D3 — deployment lifecycle: `start` / `stop` / `delete`

Outcome: `service deployment start|stop|delete` exist per R-S8-2 —
result commands on `POST /v1/deployments/{id}/start|stop` and
`DELETE /v1/deployments/{id}`; consent prompt on `delete` per the
`service remove` precedent; the artifact-not-uploaded failure on
`start` maps to a structured error. Carries the contract's
STOP-and-surface: verify the API's behavior deleting the
currently-promoted deployment before shaping the error path.

Builds on: D1 (subgroup), D2's untouched deployment plumbing.
Hands to D4: the full S8 grammar in place.

Completed when: three commands green; consent path tested; the
delete-live-deployment behavior recorded (or surfaced as a STOP).

### D4 — closure

Outcome: the records match the shipped surface. Divergence file
`assets/s2/parity-divergences-s8.md` (four renames, deleted
spellings, `live` derivation, `url` change; from D1's review round:
`service deployment list` rows report `live: null` — not `false` —
when the service names no live deployment, a JSON-only change; and
`service show` suppresses `liveUrl` when the named live deployment
is missing from the listing, narrower than "present when
`latestDeploymentId` is set"; the retired local live-state writes);
finding D1-R2-1 (v8-service-remove.test.ts's live-state clearing
assertion is vacuous — seed the key or drop the clause, reviewer's
entry has both options); `deferred.md` gains the
ownership-note revisit (R-S8-4) and the logs follow-up slice
(R-S8-5); golden-rendering updates; review loop; PR.

Builds on: D1–D3. Hands to: slice-DoD — completeness check against
the contract's acceptance list.

Completed when: acceptance list satisfiable line by line; suites
green sequentially (`@prisma/cli-engine` before `@prisma/cli`);
typecheck + lint exit 0.
