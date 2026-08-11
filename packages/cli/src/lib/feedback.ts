// Feedback must never feel slower than the thought it carries; a service
// that cannot answer quickly is treated as unavailable.
export const FEEDBACK_TIMEOUT_MS = 3_000;

const TIMEOUT_DETAIL = `The feedback service did not answer within ${FEEDBACK_TIMEOUT_MS / 1000} seconds.`;

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

export function unreachableDetail(error: unknown): string {
  if (isTimeout(error)) {
    return TIMEOUT_DETAIL;
  }
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? ` (${error.cause.message})`
      : "";
  return `The feedback service could not be reached${cause}.`;
}

export function unreadableBodyDetail(error: unknown): string {
  return isTimeout(error)
    ? TIMEOUT_DETAIL
    : "The feedback service response could not be read.";
}
