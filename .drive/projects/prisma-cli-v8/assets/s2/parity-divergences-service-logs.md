# service logs parity divergences

What changes for a user between the `service logs` that S2c shelved and
the one this slice ships. Same entry format as
[`parity-divergences.md`](parity-divergences.md), and the same standing
ruling behind it (S2 standing ruling 10: divergences are enumerated, not
discovered).

**The baseline is the shelved S2c command**, not a shipping binary. No
released CLI in this repo has had a working `service logs`: `app logs`
died with the commander shell, and S2c's replacement never landed
because the transport it needed did not exist. So nothing below breaks a
user's existing habit — but the command's shape moved a long way from
the one the S2c record describes, and that record is what a reader will
have in hand.

The command mounts as **`service logs`**, the legacy spelling, not under
the `deployment` subgroup the S8 reshape created (ruled, operator,
2026-08-13; recorded in `deferred.md`).

## Reading a page replaces holding a socket

S2c streamed: it opened a WebSocket through the compute SDK's
`streamLogs`, authenticated it with a raw token it fetched itself, and
printed records until the far end closed. There was no flag to ask for
anything else, so **following was the only behaviour**.

The platform serves one page per plain `GET` and closes it
(pdp-control-plane #4886), so the command is a page read:

- **Default: the last 100 lines, then exit 0.** The shape `kubectl logs`
  has. A script that ran the S2c command and expected it to block until
  interrupted now gets output and a clean exit instead.
- **`--follow` asks for the streaming behaviour back**, and gets polling
  rather than push: each page closes with a terminal record naming the
  cursor the next page starts at, so the command waits two seconds and
  asks again from there. The lines are the same; the latency is now
  bounded by the poll interval rather than by the server's write.
- The WebSocket upgrade still exists on the same path and the CLI never
  uses it. The engine socket transport S2c waited for was not built
  (R-S8-5), and the shelved design stays shelved for the live-streaming
  date.

## Three flags that did not exist

`--tail <n>`, `--from-start` and the page-size default are all new
surface — S2c had no way to say how much log to read.

- `--tail <n>` resizes the page; unflagged runs send `tail=100`
  explicitly, matching the endpoint's own default rather than relying
  on it.
- `--from-start` reads from the beginning instead.
- **Passing both is refused** (`SERVICE.LOGS_RANGE_CONFLICT`, exit 2),
  before the target is resolved or anything is read: they name opposite
  ends of the same log, so there is no reading that satisfies both.

`--deployment`, `--service`, `--project` and the config-target
positional carry over from S2c unchanged, resolution and error shapes
included.

## Two refusals where S2c would have carried on

Both are cases the platform contract says should not arise. They are
refused rather than absorbed, because absorbing them produces output a
user cannot tell from correct output.

- **A page that closes with no resume cursor stops `--follow`**
  (`SERVICE.LOGS_NO_CURSOR`). Continuing would mean re-requesting with no
  range, which the endpoint answers with its default tail — the same
  hundred lines reprinted every two seconds, indefinitely, with nothing
  saying why.
- **A page whose body ends without its terminal record is an incomplete
  read** (`SERVICE.LOGS_INCOMPLETE`), in page mode as well as follow.
  The lines that did arrive are still printed; what is refused is
  settling as though the whole page had been read, which would show a
  user a truncated log with no sign it was truncated.

Neither settles quietly, and the reasoning for `--follow` is that it has
no successful ending: it runs until interrupted, which settles 130, or
it fails. An exit 0 from a follow would be a new outcome meaning "gave
up", indistinguishable from a follow that never started.

## An error terminal record ends the run

`type: "terminal"` with `kind: "error"` is the platform reporting that
the log read itself failed. It settles as `SERVICE.LOGS_FAILED` carrying
the record's own code, message and `retryable` flag, exit 2 — where S2c
printed the message to the diagnostic channel and exited 0.

In `--follow`, a **retryable** error terminal is retried once after the
poll interval, and the budget resets on any page that succeeds. So a
long follow survives repeated transient failures but never loops on a
persistent one.

## Not a divergence, recorded because it looks like one

**Interrupting `--follow` settles 130.** Ctrl-C ends the run at 128 +
SIGINT from the engine's own record of the signal, so a wrapper script
that treats a non-zero exit as failure sees one when a developer stops
following.

This is worth stating because the S2c handler reads as though it did the
opposite — it treats a cancelled stream as an expected user action and
returns success. That difference is not observable: the engine settles a
signalled run at 128 + the signal "whatever the handler concluded"
(operator ruling, 2026-08-11, recorded against `composer dev` in
[`parity-divergences-s3.md`](parity-divergences-s3.md)). S2c would have
settled 130 too. The exit code comes from the engine rule, not from
anything this slice changed.
