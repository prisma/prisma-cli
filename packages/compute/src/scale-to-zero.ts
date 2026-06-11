import { writeScaleToZeroSignal } from "./scale-to-zero-control";

/**
 * Options for holding a Prisma Compute sleep guard.
 */
export interface ScaleToZeroGuardOptions {
  /**
   * Signal that releases the guard when aborted.
   *
   * Use `AbortSignal.timeout(ms)` for a time bound, or pass a request or
   * operation signal to tie the guard to caller-owned cancellation. Passing a
   * signal is strongly recommended as a safety bound for dangling guards.
   */
  signal?: AbortSignal;
}

/**
 * Keeps a Prisma Compute application awake for scoped async work.
 *
 * Creating a guard signals the compute runtime to stay awake. Calling
 * {@link ScaleToZeroGuard.release}, leaving a `using` scope, or reaching
 * the configured abort signal releases that signal. Release is idempotent, so
 * manual release and disposal can be combined safely.
 *
 * Pass `signal` whenever possible, usually from `AbortSignal.timeout(ms)`, to
 * bound how long the guard can keep the instance awake if release is not reached.
 *
 * Outside the Prisma Compute runtime, where the sleep control endpoint is
 * unavailable, the guard is a no-op.
 *
 * @example
 * ```ts
 * import { ScaleToZeroGuard } from "@prisma/compute";
 *
 * using guard = new ScaleToZeroGuard({ signal: AbortSignal.timeout(30_000) });
 * await doCriticalWork();
 * ```
 *
 * @example
 * ```ts
 * const guard = new ScaleToZeroGuard();
 * try {
 *   await doCriticalWork();
 * } finally {
 *   guard.release();
 * }
 * ```
 */
export class ScaleToZeroGuard implements Disposable {
  #active: boolean;
  #abortSignal: AbortSignal | undefined;
  #abortListener: (() => void) | undefined;

  /**
   * Creates a guard and immediately signals the compute runtime to stay awake.
   *
   * If `signal` is already aborted, no signal is written. If `signal` aborts
   * while the guard is active, the guard releases itself. Passing a signal is
   * recommended as a safety bound if release is not reached.
   */
  constructor(options: ScaleToZeroGuardOptions = {}) {
    if (options.signal?.aborted) {
      this.#active = false;
      return;
    }

    this.#active = writeScaleToZeroSignal("acquire");

    if (this.#active && options.signal !== undefined) {
      this.#abortSignal = options.signal;
      this.#abortListener = () => {
        this.release();
      };
      options.signal.addEventListener("abort", this.#abortListener, {
        once: true,
      });
    }
  }

  /**
   * Releases the guard's keep-awake signal.
   *
   * This method is idempotent. Calling it multiple times, or calling it before
   * a `using` scope exits, writes at most one release signal.
   */
  release(): void {
    if (!this.#active) {
      return;
    }

    this.#active = false;
    this.#removeAbortListener();
    writeScaleToZeroSignal("release");
  }

  /**
   * Releases the guard when used with TypeScript's `using` syntax.
   *
   * Most callers should prefer `using` for scoped work and call
   * {@link ScaleToZeroGuard.release} only when release needs to happen before
   * the scope exits.
   */
  [Symbol.dispose](): void {
    this.release();
  }

  #removeAbortListener(): void {
    if (this.#abortSignal === undefined || this.#abortListener === undefined) {
      return;
    }

    this.#abortSignal.removeEventListener("abort", this.#abortListener);
    this.#abortSignal = undefined;
    this.#abortListener = undefined;
  }
}

/**
 * Keeps a Prisma Compute application awake until a promise settles.
 *
 * The guard is acquired immediately, then released from a `finally` handler on
 * the passed promise. This function returns `void`; callers should keep using
 * the original promise for result and error handling. If `signal` aborts first,
 * only the guard is released; the passed promise continues independently.
 *
 * Pass `signal`, usually from `AbortSignal.timeout(ms)`, to bound guard lifetime
 * even when the promise does not settle.
 *
 * @example
 * ```ts
 * import { waitUntil } from "@prisma/compute";
 *
 * waitUntil(sendWebhook(), { signal: AbortSignal.timeout(10_000) });
 * ```
 */
export function waitUntil(
  promise: PromiseLike<unknown>,
  options?: ScaleToZeroGuardOptions,
): void {
  const guard = new ScaleToZeroGuard(options);

  void Promise.resolve(promise)
    .finally(() => {
      guard.release();
    })
    .catch(() => {});
}
