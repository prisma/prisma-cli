# Learnings — agent-skills-npm-packages

## 2026-08-21 — untracked working clones are one `git clean` from gone

At ~09:38Z the untracked `.refs/` tree (reference clones holding slices
1 and 4's unpushed branches) was deleted externally. Slice 1's
implementer noticed and re-cloned/redid its work; slice 4's finished,
gate-passed branch was lost entirely and had to be rebuilt. Root cause confirmed: slice 2's implementer ran
`mv .refs /tmp/slice2-refs-parked` because the clones' nested
`biome.jsonc` files abort root `pnpm lint`. On being asked it restored
everything; slice 4's branch recovered intact, slice 1's original copy
preserved for reconciliation. Lint verification now runs on an
out-of-tree copy of `packages/cli`.

Mitigations applied:
- `.refs/` added to `.git/info/exclude` (protects against `git clean -fd`,
  not `-fdx`).
- Drive project artifacts committed to the branch.
- Standing rule for all implementers: push the slice branch to origin
  after every commit; PR-open stays with the orchestrator.

Durable lesson (candidate for drive-process memory at close-out): when
dispatching implementers into clones that live inside another repo's
worktree, (a) push-early must be in the initial brief, not a recovery
rule, and (b) the clone dir must be git-excluded at creation time.
