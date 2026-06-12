import { writeScaleToZeroSignal } from "./scale-to-zero-control";

/**
 * Options for holding a Prisma Compute sleep guard.
 */
export interface ScaleToZeroGuardOptions {
  /**
   * Signal that releases the keep-awake guard when aborted.
   *
   * The signal does not cancel the underlying promise, function, or operation.
   * It only releases the guard so the application can sleep again. Use
   * `AbortSignal.timeout(ms)` with a timeout longer than the expected work as a
   * safety bound against dangling guards and unexpected cost.
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
 * The signal only releases the guard; it does not cancel the guarded work.
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
   * while the guard is active, the guard releases itself without cancelling the
   * guarded work. Passing a signal is recommended as a safety bound if release
   * is not reached.
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
 * even when the promise does not settle. Use a timeout longer than the expected
 * promise duration: the signal is a safety net for releasing the keep-awake
 * guard, not a way to cancel or interrupt the promise.
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
  // biome-ignore lint/nursery/useDisposables: waitUntil transfers guard cleanup to the promise finally handler.
  const guard = new ScaleToZeroGuard(options);

  // Do not attach a catch here; callers rely on the underlying promise keeping
  // its normal unhandled-rejection behavior.
  void Promise.resolve(promise).finally(() => {
    try {
      guard.release();
    } catch {
      // Guard cleanup must not replace the application promise's result.
    }
  });
}
