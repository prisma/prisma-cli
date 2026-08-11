# Engine-owned WebSocket transport — design

Written 2026-08-10 by the S2c orchestrating agent, at the operator's instruction, after `service logs` was shelved for want of this affordance. Status: **design, not yet scheduled against an implementer.** The slice entry is in `../../plan.md`.

## 1. Why this exists

`service logs` streams a deployment's output from `GET /v1/deployments/{deploymentId}/logs`. The Management API's own specification describes that endpoint as *"Stream deployment logs via WebSocket"* — the request upgrades to a socket. It is the only command in the platform CLI that needs a transport other than HTTP.

The engine's `ctx.api` is an HTTP client. It can hand a command a streaming HTTP response body, which is exactly how `build logs` works — plain newline-delimited JSON over `GET`, with `parseAs: "stream"`, and no credential ever visible to the command. It cannot open a socket, and a socket upgrade carries its own `Authorization` header.

So the command reached around the engine: it asked for a raw token through `ctx.getCredentials()` and let `@prisma/compute-sdk`'s `streamLogs` build the URL, flip the scheme to `wss:`, and set the header itself. That is the shape being removed. Credential-manager design rev 6 rules it out in one sentence — **credentials never reach commands; the engine may hold them** — and `getCredentials` is staged for deletion.

The operator's instruction is the design principle: **the engine provides the authenticated connection. The command does not craft a URL from a string template and does not hold a token.**

## 2. What already exists to build on

The engine resolves a credential and constructs an authenticated client today, in `packages/cli-engine/src/execution/api-client.ts`. It reads the active session, branches on where the credential came from, and builds either a static-token client (environment credential) or an SDK client over the manager's token storage (stored credential). The token stays inside that function.

A socket affordance is the same three steps with a different final constructor. It is not a new concept in the engine; it is the existing concept extended to a second transport. Under rev 6 the engine-facing accessor is `activeCredentialStorage()`, and the socket builder consumes it exactly as the HTTP client builder does.

## 3. The shape, and the one thing to get right

"An authenticated URL" has two readings, and only one of them is safe.

**Rejected: a URL carrying the token.** Putting a bearer token in a query string leaks it into server access logs, shell history, crash reports, and any error message that quotes the URL. The compute SDK deliberately avoids this today — it sets an `Authorization` header on the upgrade request instead. A design that hands commands a token-bearing URL would be a regression against the current implementation and against the custody rule.

**Chosen: the engine opens the socket and hands back the decoded record stream.** The command receives something it can iterate. It never sees a URL, a header or a token. This also keeps the retry and reconnect logic in one place — see §5.

Sketch, to be settled during implementation rather than treated as final:

```ts
// On CommandContext, beside `api`.
readonly stream: <T>(request: StreamRequest<T>) => Promise<RecordStream<T>>;

interface StreamRequest<T> {
  /** A path on the Management API, in the same style ctx.api takes. */
  readonly path: string;
  readonly params?: { readonly path?: Record<string, string>; readonly query?: Record<string, string> };
  /** Parses one wire message into a record, or rejects it. */
  readonly decode: (message: string) => T;
}

interface RecordStream<T> extends AsyncIterable<T> {
  close(): void;
}
```

An async iterable rather than a callback, because the engine's stream commands already consume records in a loop and settle on the way out, and because cancellation through `ctx.signal` composes with iteration more honestly than with a callback.

`ctx.api` stays exactly as it is. This is an addition beside it, not a replacement, and commands that need HTTP keep using HTTP.

## 4. Which command kind

The engine has three: result, session and server. `service logs` was a session command, emitting `output` events per record with a `data`-versus-`diagnostic` channel. That remains right: the socket is a source of records, not a new kind of command. No change to the command kinds is needed or wanted.

## 5. Reconnection belongs to the engine

The endpoint ends the stream after ten minutes and expects the client to reconnect with a `cursor` query parameter to continue. The terminal record carries that cursor.

Reconnection should be the engine's, for the same reason the credential is. Every command that streams would otherwise reimplement it, and each would get the edge cases subtly differently — what counts as a resumable end, how many attempts, what backoff, what happens when the cursor is absent, and how a genuine failure is distinguished from a routine ten-minute rollover.

Two things follow, and both need a decision at implementation time:

- **A resumable end must not surface to the command as a stream ending.** If the engine reconnects transparently, the command sees one uninterrupted sequence of records. That is the behaviour to aim for.
- **A terminal record that is genuinely terminal must still reach the command**, because commands map terminal state onto their own settlement. The distinction the wire protocol already draws — `kind: "end" | "error"`, plus `retryable` — is the input to that.

## 6. Testing

The harness has to be able to drive this without a network. Today `createTestCli` fakes the Management API by accepting a client; the socket affordance needs the equivalent seam — a way to seed a sequence of wire messages, including a mid-stream resumable end, so reconnection is exercised rather than assumed.

This is also the moment to fix a harness inconsistency found while investigating: seeding an environment token gives a run a session and sets `PRISMA_SERVICE_TOKEN` in its environment, but the harness's `getCredentials` stub ignores it and resolves nothing, where the real runtime returns that token first. If `getCredentials` is deleted as rev 6 intends, the inconsistency goes with it. If it survives longer than expected, it should be corrected on its own.

## 7. Open questions for whoever picks this up

1. **The endpoint is marked experimental** in the Management API specification — "in active development and may change at any time without notice". Confirm it is stable enough to build engine support against before starting, and ideally get the WebSocket contract pinned.
2. **Is a socket the right transport at all?** `build logs` streams over plain HTTP from a sibling endpoint. If deployment logs could be served the same way, the whole affordance becomes unnecessary and `service logs` becomes a copy of `build logs`. This is worth one conversation with the API owners before building anything — it is by far the cheapest outcome.
3. **Does anything other than `service logs` need it?** If not, question 2 gets more attractive, and the affordance should probably wait until a second consumer exists.
4. **Where does the compute SDK's `streamLogs` fit?** The engine could use it internally rather than opening its own socket, provided the token stays engine-side. That keeps the wire protocol in one place, at the cost of a dependency direction the engine may not want.

## 8. Out of scope

Rebuilding `service logs` itself. That command's handler — the resolution, the channel routing, the record-to-event mapping — was written, reviewed and green before it was shelved, and it is in this branch's history. Restoring it should be a small piece of work once the affordance exists, not a rewrite.
