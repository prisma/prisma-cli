/**
 * The linking step: bind this directory to a Prisma Project. It runs
 * `project link`'s own flow (`linkDirectoryToProject`), so the picker,
 * the create-a-Project choice and the pin write have one implementation.
 *
 * Two things differ from `project link`. The legacy step called
 * `runProjectLink`, which called `requireAuthenticatedAuthState` and
 * launched a browser login on a terminal; this reads the credential the
 * way `auth whoami` does and, when there is none, reports the step as
 * unauthenticated and offers `auth login` as a next action (R-S2d-1).
 * And the config write has already succeeded by the time this runs, so a
 * link that fails is a warning on a successful init, never a failure.
 */
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { readLocalResolutionPin } from "../../lib/project/local-pin";
import { linkDirectoryToProject } from "../project/link";
import type { InitFlags, InitLinkState, InitStepContext } from "./types";

const SKIPPED: InitLinkState = { status: "skipped", project: null };

function signInRequired(step: InitStepContext): InitLinkState {
  const link = step.formatCommand(["project", "link"]);
  step.record({
    code: "INIT.LINK_REQUIRES_SIGN_IN",
    severity: "warn",
    summary: `Not linked to a Project: you are not signed in. Sign in, then link with ${link}.`,
    nextActions: [
      {
        kind: "run-command",
        label: "Sign in",
        command: `${CLI_NAME} auth login`,
      },
    ],
  });
  return { status: "unauthenticated", project: null };
}

/** Both CliError and CliStructuredError carry their summary as the
 *  message, which is the sentence the legacy warning quoted. */
function linkFailed(step: InitStepContext, error: unknown): InitLinkState {
  const detail = error instanceof Error ? error.message : String(error);
  const link = step.formatCommand(["project", "link"]);
  step.record({
    code: "INIT.LINK_FAILED",
    severity: "warn",
    summary: `Project link failed: ${detail}. Link later with ${link}.`,
    nextActions: [{ kind: "run-command", label: link, command: link }],
  });
  return { status: "failed", project: null };
}

export async function resolveLink(
  flags: InitFlags,
  step: InitStepContext,
): Promise<InitLinkState> {
  const ctx = step.engine;
  const pin = await readLocalResolutionPin(ctx.cwd, ctx.signal);
  if (pin.isOk() && pin.value.kind === "present") {
    return { status: "already-linked", project: null };
  }
  if (flags.link === false) {
    return SKIPPED;
  }

  const explicitProject = flags.project?.trim();
  const shouldLink =
    Boolean(explicitProject) ||
    flags.link === true ||
    (await ctx.prompt.confirm("Link this directory to a Prisma Project now?", {
      default: false,
    }));
  if (!shouldLink) {
    return { status: "declined", project: null };
  }

  if ((await ctx.activeCredential())?.workspaceId === undefined) {
    return signInRequired(step);
  }

  try {
    const linked = await linkDirectoryToProject(ctx, explicitProject);
    return { status: "linked", project: linked.project };
  } catch (error) {
    ctx.signal.throwIfAborted();
    // Ctrl-C is the user leaving, not a step that failed: it settles the
    // whole command at exit 3. Everything else — including a picker with
    // nobody to answer it — downgrades to a warning, because the config
    // write already succeeded and a failed link must not undo it.
    if (CliStructuredError.is(error) && error.code === "CLI.PROMPT_CANCELLED") {
      throw error;
    }
    return linkFailed(step, error);
  }
}
