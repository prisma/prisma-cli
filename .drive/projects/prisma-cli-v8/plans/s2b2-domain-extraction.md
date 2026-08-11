# S2b2 dispatch plan — domain extraction, bucket group

Contract: `../specs/s2b2-domain-extraction.md`. Branch `s2b2-domain-extraction` off `main`.

Standing rules as in S2b's plan: explicit staging; the six verification commands before every commit, each judged by its own exit code and never chained off an echo; an unpinned fact is a STOP, not a guess.

**The tests are the specification.** S2b's implementer worked from design documents because the behaviour was being created. Here it exists and is asserted from outside, so no test may be edited to accommodate a move. A test that needs changing means the move changed behaviour.

### D1 — the four provider-only commands
`bucket delete`, `bucket key list`, `bucket key create`, `bucket key delete`. These reach nothing but `BucketProvider`, so this dispatch establishes the whole shape against the easy case: the port interface moves to `use-cases/bucket/`, `createManagementBucketProvider` moves to `adapters/bucket/`, four use cases are written, four handlers are reduced to parsing and presentation.

It also settles two questions the later groups inherit, and settles them where they are cheap: where consent sits for `bucket delete` (the handler, per R-Y-2), and how a one-time secret is handled for `bucket key create` — the use case returns the credentials, the handler decides that stdout gets them bare and the card gets them masked.

### D2 — the two project-addressing commands
`bucket list` and `bucket create`. Introduces the two shared ports for project resolution and implements them over the existing functions. This is where the slice meets the problem every other group has, so it is the dispatch whose difficulty predicts the rest.

### D3 — the boundary check and closure
A test asserting that nothing under `src/v8/bucket/**` imports from `shell/`, `controllers/`, `presenters/` or `lib/` — which makes the second acceptance box enforced rather than inspected. Then the review round, the reassessment write-up the contract requires, and the PR.

Completeness: D1 → the shape, consent and secrets; D2 → shared resolution; D3 → the boundary check, the reassessment, closure. Every acceptance box maps to exactly one dispatch.

## The reassessment this slice exists to inform

D3's write-up answers, with evidence rather than impression:

- What did the six handlers actually shrink to, and how much of that was presentation rather than logic?
- Did any port signature need an engine or shell type, and if so which and why?
- `bucket list` and `bucket create` reach project resolution through the legacy-context adapter. Did the two shared ports isolate that cleanly, or did the adapter leak into the use case?
- Which of R-Y-1 to R-Y-8 was hardest to hold, and what did holding it cost?
- On that evidence: do the remaining four groups go in one slice or four?

That last question is the operator's, and this slice exists to make it answerable.
