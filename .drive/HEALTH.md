# Health checks — prisma-cli

Repository rules for Drive project health checks. They apply at every slice merge, in addition to the standard checks.

## Close out the deferred ledger as you go

At each slice merge, go through `.drive/projects/<project>/deferred.md`. Every entry the slice touched, and every entry that has survived one slice, leaves the ledger in one of four ways:

- **Done:** delete it.
- **Moot:** delete it, with the reason in the commit message.
- **Still real:** file a GitHub issue in the repository that owns the fix, and replace the entry with the link.
- **Needs a ruling:** ask the operator now. When the ruling is made, write it into the document it governs (`docs/`, an ADR, `AGENTS.md`), not only into the ledger.

The ledger holds only entries that are waiting on something named, such as a release or a ruling that has been requested.

Why: the prisma-cli-v8 project closed on 2026-09-27 with a 79-entry ledger that nothing had revisited in six weeks. 40 entries were already done or moot. One ruling (remove the `npx skills add` copy button from the login page, made 2026-08-24) was never carried out, and another (split per-database agent skills by name) existed only in the ledger, so deleting the project would have deleted it.

## Re-read the acceptance criteria when the design changes

When a slice changes the design, re-read the project's acceptance criteria and amend any the change invalidates, with the operator, in that slice.

Why: at the prisma-cli-v8 close-out, two of eight criteria could no longer be met as written. One asked for a config file with sections for three product families, but the design never gave the Cloud family a config section. Another asked for operator sign-off on per-family parity lists, which lost their purpose when the legacy CLIs were retired. Both had been wrong for weeks and surfaced only at close.
