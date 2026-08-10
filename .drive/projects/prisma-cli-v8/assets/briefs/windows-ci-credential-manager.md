# The three Windows CI failures on `s2a-foundations`

Written 2026-08-10 by the s2b-resources orchestrator. All three are in `packages/cli/tests/credential-manager.test.ts` and belong to the auth stream. They are recorded here rather than fixed because `packages/cli/src/auth/**` is a no-touch boundary for the resources slice, and because fixing them inside PR #133 would mix auth-stream changes into a resource port.

They are pre-existing, not caused by PR #133. The same three, and only these three, fail on `s2a-foundations` itself — verified at its tip 96e5628 and at the two commits before it. PR #133 briefly added a fourth, which is fixed; its Windows job now fails on exactly this set.

Two of the three are test-only. **The third is a real defect on Windows** and is the reason this note exists.

## The real one: the lock takeover is not exclusive on Windows

Failing case: "lets only one of two waiting mutations clear the same crashed holder's lock". It asserts that exactly one racer logs a takeover; on Windows both do.

The takeover is at `packages/cli/src/auth/state-file.ts:295-302`:

```ts
const takenPath = `${lockPath}.${randomUUID()}.stale`;
try {
  await fs.rename(lockPath, takenPath);
} catch {
  // Someone else took it over, or it was released — go round again
  return false;
}
```

Its correctness rests entirely on the loser's `rename` failing once the winner has moved the lock away. On POSIX that holds: the second rename hits a path that no longer exists and throws. On Windows, both renames reported success, so both processes believed they held the lock — precisely the interleaving the lock exists to prevent.

I have not diagnosed the Windows rename semantics that allow it, and I would not want to guess in someone else's concurrency code. What is certain from the failure is that the exclusivity the comment claims does not hold on Windows, so the advisory lock does not prevent a lost update there.

Worth noting: the takeover only runs after the staleness threshold, so this needs a crashed holder plus two concurrent mutations. Rare, but the consequence is two processes writing the credential state at once.

## The two test-only ones

"writes the normative shape with mode 0600" and "tightens permissions looser than 0600" both end in an assertion of POSIX permission bits, for example at `credential-manager.test.ts:128`:

```ts
expect((await stat(stateFilePath)).mode & 0o777).toBe(0o600);
```

Windows has no POSIX mode bits. Node reports `0o666` (decimal 438) whatever `chmod` was asked for, which is exactly what CI shows: "expected 438 to be 384". The implementation is not wrong; the assertion cannot hold on that platform.

The fix is to skip the permission assertion on Windows. PR #133 does the same thing for the same reason in `tests/v8-project.test.ts`, where a case needs a directory whose permissions stop a delete:

```ts
it.skipIf(process.platform === "win32")("…", async () => { … });
```

Skipping the whole case is right for the two above, since the file-shape assertions they also make are covered elsewhere. Note that this does **not** apply to the lock case — skipping that one would hide a real defect rather than an untestable assertion.

## Why PR #133 cannot go green on Windows by itself

Everything else passes: Lint, Type Check, Test, preview, and `test (ubuntu-latest)`. The Windows job stays red until these land, and they belong to the stream that owns the credential manager.
