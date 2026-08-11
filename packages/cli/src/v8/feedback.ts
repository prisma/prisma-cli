import type { Presentations } from "@prisma/cli-engine";
import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../cli-name";
import { getCliVersion } from "../lib/version";

const DEFAULT_FEEDBACK_ENDPOINT =
  "https://hiieirp2pwqnjvq9axzyg6d0.fra.prisma.build/feedback";
// Feedback must never feel slower than the thought it carries; a service
// that cannot answer quickly is treated as unavailable.
const FEEDBACK_TIMEOUT_MS = 3_000;
// Mirrors the feedback service's own limits so refusals happen before the
// network round trip.
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_EMAIL_LENGTH = 320;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMEOUT_DETAIL = `The feedback service did not answer within ${FEEDBACK_TIMEOUT_MS / 1000} seconds.`;

interface FeedbackContext {
  cliVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
}

interface FeedbackResult {
  id: string | null;
  email: string | null;
  context: FeedbackContext;
}

function sendFailedError(detail: string): CliStructuredError {
  return new CliStructuredError(
    "FEEDBACK.SEND_FAILED",
    "Feedback could not be delivered",
    {
      why: detail,
      nextActions: [
        { kind: "user-choice", label: "Check your network and rerun." },
      ],
    },
  );
}

function messageRequiredError(): CliStructuredError {
  return new CliStructuredError(
    "FEEDBACK.MESSAGE_REQUIRED",
    "Feedback message required",
    {
      why: "The message argument is empty.",
      nextActions: [
        { kind: "user-choice", label: "Pass a non-empty message." },
        {
          kind: "run-command",
          label: "Send feedback",
          command: `${CLI_NAME} feedback "the deploy flow is great"`,
        },
      ],
    },
  );
}

function messageTooLongError(length: number): CliStructuredError {
  return new CliStructuredError(
    "FEEDBACK.MESSAGE_TOO_LONG",
    "Feedback message too long",
    {
      why: `The message is ${length} characters; the limit is ${MAX_MESSAGE_LENGTH}.`,
      nextActions: [{ kind: "user-choice", label: "Shorten the message." }],
    },
  );
}

function emailInvalidError(value: string): CliStructuredError {
  return new CliStructuredError("FEEDBACK.EMAIL_INVALID", "Invalid email", {
    why: `"${value}" is not a valid email address of at most ${MAX_EMAIL_LENGTH} characters.`,
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Pass a valid address with --email, or drop the flag to stay anonymous.",
      },
      {
        kind: "run-command",
        label: "Send feedback with a contact address",
        command: `${CLI_NAME} feedback "please add X" --email you@example.com`,
      },
    ],
  });
}

function feedbackPresentations(result: FeedbackResult): Presentations {
  return {
    human: () => [
      { kind: "summary", tone: "ok", text: "Feedback sent. Thank you!" },
      {
        kind: "fields",
        rows: [
          ...(result.id ? [{ label: "id", value: result.id }] : []),
          { label: "sent as", value: result.email ?? "anonymous" },
          {
            label: "included",
            value: `CLI ${result.context.cliVersion}, node ${result.context.nodeVersion}, ${result.context.platform} ${result.context.arch}`,
          },
        ],
      },
    ],
  };
}

async function readServiceError(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  let payload: { error?: { message?: unknown } } | null;
  try {
    payload = (await response.json()) as {
      error?: { message?: unknown };
    } | null;
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    return "";
  }
  return typeof payload?.error?.message === "string"
    ? ` (${payload.error.message})`
    : "";
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function unreachableDetail(error: unknown): string {
  if (isTimeout(error)) {
    return TIMEOUT_DETAIL;
  }
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? ` (${error.cause.message})`
      : "";
  return `The feedback service could not be reached${cause}.`;
}

function unreadableBodyDetail(error: unknown): string {
  return isTimeout(error)
    ? TIMEOUT_DETAIL
    : "The feedback service response could not be read.";
}

async function sendFeedback(
  endpoint: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": `${CLI_NAME}/${getCliVersion()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(FEEDBACK_TIMEOUT_MS),
      ]),
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw sendFailedError(unreachableDetail(error));
  }
}

async function readSubmissionId(
  response: Response,
  signal: AbortSignal,
): Promise<string | null> {
  // The body read runs under the same abort signal as the request, so a
  // stalled response or a user cancellation here must not be mistaken for a
  // fully received non-JSON body.
  let payload: { id?: unknown } | null;
  try {
    payload = (await response.json()) as { id?: unknown } | null;
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    if (!(error instanceof SyntaxError)) {
      throw sendFailedError(unreadableBodyDetail(error));
    }
    // The body arrived but was not JSON; the submission itself succeeded.
    payload = null;
  }
  return typeof payload?.id === "string" ? payload.id : null;
}

async function postFeedback(
  endpoint: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string | null> {
  const response = await sendFeedback(endpoint, body, signal);

  if (!response.ok) {
    throw sendFailedError(
      `The feedback service responded with HTTP ${response.status}${await readServiceError(response, signal)}.`,
    );
  }

  return readSubmissionId(response, signal);
}

export const feedbackCommand = defineCommand({
  help: {
    summary: "Send feedback to the Prisma CLI team",
    description:
      "Anonymous unless --email is passed. Every submission includes the CLI\n" +
      "version, node version, and OS platform/arch, and nothing else.",
    examples: [
      'feedback "the deploy flow is great"',
      'feedback "please add X" --email you@example.com',
    ],
  },
  args: {
    flags: {
      email: flag.string({
        brief:
          "Contact email if you want a reply; feedback is anonymous without it",
        placeholder: "address",
      }),
    },
    positionals: {
      message: positional.string({
        brief: "Feedback text (up to 4000 characters)",
        placeholder: "message",
      }),
    },
  },
  handler: async (args, ctx) => {
    const message = args.positionals.message.trim();
    if (!message) {
      throw messageRequiredError();
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw messageTooLongError(message.length);
    }

    const email = args.flags.email?.trim();
    if (
      email !== undefined &&
      (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email))
    ) {
      throw emailInvalidError(args.flags.email ?? "");
    }

    const context: FeedbackContext = {
      cliVersion: getCliVersion(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    };
    const id = await postFeedback(
      ctx.env.PRISMA_CLI_FEEDBACK_URL || DEFAULT_FEEDBACK_ENDPOINT,
      {
        message,
        ...(email ? { email } : {}),
        meta: { ...context },
      },
      ctx.signal,
    );

    const result: FeedbackResult = {
      id,
      email: email ?? null,
      context,
    };
    return ok(ctx.present({ data: result }, feedbackPresentations(result)));
  },
});
