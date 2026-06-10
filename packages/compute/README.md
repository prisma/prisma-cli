# Prisma Compute

`@prisma/compute` provides runtime utilities for applications deployed to Prisma
Compute.

## Preventing Application Sleep

Applications deployed to Prisma Compute can sleep after short periods of inactivity. When an application sleeps, Prisma Compute snapshots its memory and resumes from that snapshot when the next request arrives.

This works well for request-driven code, but background work outside the request lifecycle can be interrupted when the application sleeps. Examples include `setTimeout`, `setInterval`, and background `Promise` work.

`@prisma/compute` provides two utilities that signal to Prisma Compute that work is still active and the application should stay awake.

`waitUntil` keeps the application awake until a `Promise` settles. It returns `void`, so callers should keep using the original promise for result and error handling. Pass an `AbortSignal`, usually from `AbortSignal.timeout(ms)`, as a safety bound if the promise does not settle. `waitUntil` can be called multiple times during a single request.

```ts
import { waitUntil } from "@prisma/compute";

waitUntil(doCriticalWork(), { signal: AbortSignal.timeout(30_000) });
```

`ScaleToZeroGuard` is a disposable object that keeps the application awake until the guard is released. Use it for a scoped function or block of background work. `ScaleToZeroGuard` can be created multiple times during a single request and is safe to nest. Pass an `AbortSignal`, usually from `AbortSignal.timeout(ms)`, as a safety bound if release is not reached.

Read more about disposables and the `using` keyword in the [MDN resource management guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Resource_management).

```ts
import { ScaleToZeroGuard } from "@prisma/compute";

async function runsInBackground() {
  // guard is acquired here
  using guard = new ScaleToZeroGuard({ signal: AbortSignal.timeout(30_000) });
  await doCriticalWork();
} // guard is released here
```

If `using` is not available, call `.release()` manually. Always release the guard in a `finally` block so it is released even if the guarded code throws.

```ts
import { ScaleToZeroGuard } from "@prisma/compute";

async function runsInBackground() {
  const guard = new ScaleToZeroGuard({ signal: AbortSignal.timeout(30_000) });

  try {
    await doCriticalWork();
  } finally {
    guard.release();
  }
}
```
