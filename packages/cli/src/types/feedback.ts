export interface FeedbackResult {
  id: string | null;
  email: string | null;
  context: FeedbackContext;
}

/** Non-PII environment details attached to every submission. */
export interface FeedbackContext {
  cliVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
}
