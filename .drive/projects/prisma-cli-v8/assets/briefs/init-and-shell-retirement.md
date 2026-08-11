# Brief: port `init`, then delete the old CLI

Written 2026-08-11 for an agent with no prior context. The operator is Will Madden. Everything you need is here or in the documents named; where this brief summarises a document, the document wins.

## What this slice is

Repo `prisma/prisma-cli`. This is the last slice of the platform port. Two things happen in it, in this order:

1. **Port the two commands that are left** — the `init` wizard and the `version` command — onto the new engine.
2. **Delete the old CLI**: the commander-based shell, the fixture/mock machinery, and everything that only existed to serve them. Then make the engine-based binary the one we ship.

When this lands, `prisma-cli` runs entirely on `@prisma/cli-engine` and the old shell is gone.

The slice contract is `.drive/projects/prisma-cli-v8/specs/s2d-init-and-retirement.md`. Read it in full before you touch anything — it is normative. One warning about it: the paragraph on the shipped-binary cutover contradicts itself mid-sentence ("Resolution is pinned… STOP: that is not pinned anywhere"). That is a previous author catching their own error. The question ledger in `.drive/projects/prisma-cli-v8/specs/s2-overview.md` is authoritative on that point, and see "The one thing that is blocked" below.

## Do not start yet

Two pull requests must land before you begin, because both add commands to the tree you are about to complete and delete code you are about to remove:

- **#133** — the resources port, and the `database` → `postgres` rename. Awaiting first review.
- **#132** — the services port (`app` becomes `service`). Currently at changes-requested.

Starting before these merge means rebasing a very large deletion across two moving branches. Wait.

## The one thing that is blocked, and what is not

**The shipped binary cannot read the config file.** The CLI reads `prisma.config.ts` from the user's project, and the loader (`packages/cli-engine/src/config-loader.ts`) does a plain dynamic `import()` of that path. That works today only because everything runs under `tsx`. The binary we ship runs on ordinary Node, which cannot execute TypeScript, so as things stand the released CLI cannot read the config file it is built around.

The operator has to choose the strategy: bundle a TypeScript-capable loader such as `jiti`, require a TypeScript-capable runtime and document it, or support only a compiled/JSON config in the shipped binary. It changes what a user must install before the CLI works at all, so it is not yours to pick.

**Ask for that ruling early, then get on with everything else.** Only the binary cutover depends on it. The `init` port, the `version` port, the deletions and the grammar check all proceed without it.

## The work, in the order I would do it

**1. Port `init`.** It is the hardest command in the product and the reason this slice is last. Today it is `packages/cli/src/controllers/init.ts`, about 1,100 lines. It is a wizard: project name, template and framework selection, a linking question, writing environment files, and an offer to install the agent skill. The contract pins the step list and the current defaults.

Three things to get right. The prompts run on the engine's prompt surface, so the wizard must work interactively, under `--yes`, non-interactively, and when cancelled — that matrix is the acceptance bar. The files it writes are data, not rendering: the templates stay byte-asserted against what the current CLI produces. And the step that checks whether you are signed in must read auth state without forcing a login, the way `auth whoami` does, offering a sign-in next action instead — if that differs from the current behaviour, record the difference.

**2. Port `version`.** The `--version` flag already exists on the engine. This is the `version` *command*, presenting version, node and platform, with a JSON serializer. Small, but user-visible, so it gets the same test matrix as anything else.

**3. Delete the old CLI.** Do this only once every port is green, and as its own commit series so the diff is reviewable. The scale, as of today:

| Directory | Files | Lines |
| --- | --- | --- |
| `src/shell` | 13 | 2,462 |
| `src/controllers` | 16 | 13,032 |
| `src/presenters` | 12 | 3,317 |
| `src/adapters` | 3 | 1,073 |
| `src/use-cases` | 5 | 713 |

Not all of that dies. Controllers and presenters survive **only** where the ported commands still call them as an operation layer — the new command asks the old function to do the API work. Enumerate the survivors explicitly in the pull request; a survivor nobody listed is how this kind of deletion goes wrong.

Also delete: the fixture machinery (`src/adapters/mock-api.ts`, `src/use-cases/**`, the fixture providers, and every `isRealMode` branch — seven files mention it or the `PRISMA_CLI_MOCK_FIXTURE_PATH` variable), all remaining fixture-mode tests, that environment variable itself, and `--trace`.

**One knot worth knowing about before you pull on it.** `src/auth/errors.ts` still constructs `CliError`, the old shell's error class, and `src/v8/auth/errors.ts` maps those into structured errors. So the auth module depends on the shell it is meant to outlive. When the shell dies, either `CliError` moves somewhere durable or the auth operations throw structured errors directly and both mapping layers go. The second is cleaner. Decide deliberately rather than discovering it halfway through the deletion.

**4. Cut the binary over** (needs the ruling above). `packages/cli/package.json`'s `bin` points at the engine entry, the build bundles the new tree, and the `prisma-v8` working name and its root script are deleted. Prove it by running the packed tarball on plain Node — not through `tsx`.

**5. Add the grammar completeness check.** A build-time test asserting the mounted command tree is exactly the target grammar: every command in the inventory, minus the ruled removals, plus the ruled renames. The removals so far are `service build`, `service deploy` and `service run` — all superseded by Composer — and the mock-only login flags. `.drive/projects/prisma-cli-v8/assets/s2/command-inventory.md` is the inventory.

**6. Consolidate the divergence record.** Every slice has been appending user-visible differences from the old CLI to `.drive/projects/prisma-cli-v8/assets/s2/parity-divergences.md`. Fold yours in and hand the whole document to the operator for sign-off. This is the last chance to catch a behaviour change nobody meant to ship.

## What the engine gives you

The engine surface changed substantially in the slice that just merged, so anything you read in an older document may be stale. As of now: a command reads `ctx.activeCredential()` for what the process is authenticated as; there is no `getCredentials` and no raw token available to a command; the credential manager has seven members; and the test harness seeds are `sessions`, `selectedWorkspaceId`, `credential` and `environmentCredential`. `packages/cli-engine/src/credential-manager.ts` and `context.ts` are the truth.

For prompts specifically — the surface you will lean on hardest — read `packages/cli-engine/src/context.ts` (`PromptSurface`) and `packages/cli-engine/tests/interaction-affordances.test.ts`. Consent is deliberately not defaultable: `--yes` cannot satisfy it, and a destructive prompt with a token needs `--confirm <token>` non-interactively.

## Verification

Every one of these must exit 0 before you report anything as done:

```
pnpm --filter @prisma/cli-engine test
pnpm --filter @prisma/cli test
pnpm --filter @repo/cli-telemetry test
pnpm typecheck
pnpm lint
```

Engine tests that use `createTestCli` execute the **built** `dist`, so run the package's own `test` script, which builds first. Invoking vitest directly gives you stale results. This has caused wasted work twice.

A passing test is not the same as a test that holds the behaviour down. For anything you claim is fixed, break the code deliberately and confirm the test fails. Two real defects in the last slice were found exactly this way, and one flaky-looking test turned out to be a genuine deadlock.

## Process rules, non-negotiable

- **Git identity.** You act as the `wmadden-electric` bot. Stage explicitly by path — never `git add -A`, never anything under `wip/` or `.drive/projects/prisma-cli-v8/specs/reviews/`. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Push only to the `bot` remote (`git@github-wmadden-electric:prisma/prisma-cli.git`).
- **Finish the job.** The deliverable is a pull request. Commit, push, and open it — draft if the work is partial, saying what is unresolved. Do not end with work sitting uncommitted.
- **Pull request text.** The operator's structure: a grounding example first (a real command run, before and after), then the decision, then the narrative building up, alternatives last. No internal process codes, no dispatch or round labels, no reviewer numbering. Assume the reader has none of your context — spell out any project shorthand rather than making them look it up.
- **Reports.** Plain English, full sentences, no invented jargon, no session-internal labels. Banned words: "load-bearing", "smoking gun", "belt and suspenders", "gate". Bring questions to decide, not decisions to ratify. Stop on any contradiction between the design and the code that the design does not anticipate — never improvise.
- **Subagents** on Opus, implementers and reviewers alike.

## Wider state

The engine publishes as `@prisma/cli-engine`. Nothing publishes automatically any more: a push to `main` publishes only when it changes the committed version, and `8.0.0-rc.1` is committed but deliberately **not** released. Do not bump the version and do not publish.

Other agents work the two open pull requests independently. Do not touch their branches.

The remaining unanswered questions are in `.drive/projects/prisma-cli-v8/specs/s2-overview.md`. Besides the config-evaluation one, the one most likely to reach you is whether an unauthenticated command should still launch a browser login automatically the way the old CLI did — the port fails with a sign-in error instead. It is built to that default and unratified.
