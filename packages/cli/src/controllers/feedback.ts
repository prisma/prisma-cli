import {
  FEEDBACK_TIMEOUT_MS,
  unreachableDetail,
  unreadableBodyDetail,
} from "../lib/feedback";
import { getCliVersion } from "../lib/version";
import { CliError, usageError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import type { FeedbackContext, FeedbackResult } from "../types/feedback";

const DEFAULT_FEEDBACK_ENDPOINT =
  "https://hiieirp2pwqnjvq9axzyg6d0.fra.prisma.build/feedback";
// Mirrors the feedback service's own limits so refusals happen before the
// network round trip.
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_EMAIL_LENGTH = 320;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FeedbackFlags {
  email?: string;
}

export async function runFeedback(
  context: CommandContext,
  messageArg: string,
  flags: FeedbackFlags,
): Promise<CommandSuccess<FeedbackResult>> {
  const message = messageArg.trim();
  if (!message) {
    throw usageError(
      "Feedback message required",
      "The message argument is empty.",
      "Pass a non-empty message.",
      ['prisma-cli feedback "the deploy flow is great"'],
    );
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw usageError(
      "Feedback message too long",
      `The message is ${message.length} characters; the limit is ${MAX_MESSAGE_LENGTH}.`,
      "Shorten the message.",
    );
  }

  const email = flags.email?.trim();
  if (
    email !== undefined &&
    (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email))
  ) {
    throw usageError(
      "Invalid email",
      `"${flags.email}" is not a valid email address of at most ${MAX_EMAIL_LENGTH} characters.`,
      "Pass a valid address with --email, or drop the flag to stay anonymous.",
      ['prisma-cli feedback "please add X" --email you@example.com'],
    );
  }

  const feedbackContext: FeedbackContext = {
    cliVersion: getCliVersion(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  };

  const endpoint =
    context.runtime.env.PRISMA_CLI_FEEDBACK_URL || DEFAULT_FEEDBACK_ENDPOINT;
  const id = await postFeedback(context, endpoint, {
    message,
    ...(email ? { email } : {}),
    meta: { ...feedbackContext },
  });

  return {
    command: "feedback",
    result: {
      id,
      email: email ?? null,
      context: feedbackContext,
    },
    warnings: [],
    nextSteps: [],
  };
}

async function postFeedback(
  context: CommandContext,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<string | null> {
  const response = await sendFeedback(context, endpoint, body);

  if (!response.ok) {
    throw feedbackSendFailed(
      `The feedback service responded with HTTP ${response.status}${await readServiceError(context, response)}.`,
    );
  }

  return readSubmissionId(context, response);
}

async function sendFeedback(
  context: CommandContext,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Response> {
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": `prisma-cli/${getCliVersion()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([
        context.runtime.signal,
        AbortSignal.timeout(FEEDBACK_TIMEOUT_MS),
      ]),
    });
  } catch (error) {
    if (context.runtime.signal.aborted) {
      throw error;
    }
    throw feedbackSendFailed(unreachableDetail(error));
  }
}

async function readSubmissionId(
  context: CommandContext,
  response: Response,
): Promise<string | null> {
  // The body read runs under the same abort signal as the request, so a
  // stalled response or a user cancellation here must not be mistaken for a
  // fully received non-JSON body.
  let payload: { id?: unknown } | null;
  try {
    payload = (await response.json()) as { id?: unknown } | null;
  } catch (error) {
    if (context.runtime.signal.aborted) {
      throw error;
    }
    if (!(error instanceof SyntaxError)) {
      throw feedbackSendFailed(unreadableBodyDetail(error));
    }
    // The body arrived but was not JSON; the submission itself succeeded.
    payload = null;
  }
  return typeof payload?.id === "string" ? payload.id : null;
}

async function readServiceError(
  context: CommandContext,
  response: Response,
): Promise<string> {
  let payload: { error?: { message?: unknown } } | null;
  try {
    payload = (await response.json()) as {
      error?: { message?: unknown };
    } | null;
  } catch (error) {
    if (context.runtime.signal.aborted) {
      throw error;
    }
    return "";
  }
  return typeof payload?.error?.message === "string"
    ? ` (${payload.error.message})`
    : "";
}

function feedbackSendFailed(detail: string): CliError {
  return new CliError({
    code: "FEEDBACK_SEND_FAILED",
    domain: "cli",
    summary: "Feedback could not be delivered",
    why: detail,
    fix: "Check your network and rerun the command.",
    exitCode: 1,
    nextSteps: [],
  });
}
