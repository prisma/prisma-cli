# The three Windows CI failures on `s2a-foundations` — resolved

Written 2026-08-10 by the s2b-resources orchestrator, and updated the same night once the auth stream fixed all three. Kept rather than deleted because one of them was a real concurrency bug and the diagnosis is worth having on the record.

**Current state: all three pass. The Windows job on PR #133 is green.** Nothing here is outstanding.

## What was failing

Three cases in `packages/cli/tests/credential-manager.test.ts`, all pre-existing rather than caused by PR #133 — the same three, and only these three, failed on `s2a-foundations` itself at its then-tip 96e5628 and the two commits before it. PR #133 briefly added a fourth of its own, which was fixed separately by skipping a case whose Unix-only setup Windows cannot reproduce.

Two were test-only. "writes the normative shape with mode 0600" and "tightens permissions looser than 0600" ended in an assertion of POSIX permission bits, which Windows has no representation for — Node reports `0o666` whatever `chmod` was asked for, hence CI's "expected 438 to be 384".

**The third was a real defect.** "lets only one of two waiting mutations clear the same crashed holder's lock" asserted that exactly one racer takes over a crashed holder's lock; on Windows both did. The takeover rested entirely on the loser's `fs.rename` failing once the winner had moved the lock away — true on POSIX, not true there — so two processes could believe they held the credential lock at once, which is the interleaving the lock exists to prevent.

## How they were fixed

By the auth stream, on `s2a-foundations`:

- The permission assertions are now guarded by a `POSIX_MODES` constant, so they run where the concept exists and are skipped where it does not. Same approach PR #133 took for its own Unix-only case.
- The real one is `fec6678`, "close the stale-lock takeover race the Windows runner exposed". `rename` cannot be made conditional, so the takeover now confirms afterwards that what it moved aside is the same lock it examined, comparing modification times, and puts it back with `link` — which fails when the path is occupied — if it is not. The exclusivity the lock needs no longer depends on rename semantics that differ by platform.
- The takeover assertion moved from "exactly one" to "at most one". Worth noting that this does not weaken the defect check: the failure being guarded against was **two** takeovers, which the assertion still catches. It now tolerates zero, which is the race simply not materialising.

## Why this is recorded

The Windows runner exposed a genuine cross-platform concurrency bug in credential storage that no Unix run would have caught, and it was found only because a resources-slice PR made someone read a red Windows job carefully instead of dismissing it as the usual platform noise. That is the argument for keeping the Windows matrix meaningful and for not reaching for a skip before understanding which failures are artifacts and which are real.
