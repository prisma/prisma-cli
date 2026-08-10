/**
 * The engine's browser-opening effect, behind ctx.openUrl and
 * prompt.browserWait. One announcement — an `endpoint` event, which is
 * a stderr line in human mode and a frame in json mode, so the URL
 * reaches a machine consumer through the existing event vocabulary —
 * and, when the session is interactive and the runtime wired an opener,
 * the open itself. Never an error: a session that cannot open a browser
 * is told the URL and reports opened: false.
 */
import type { OpenUrlOutcome, OpenUrlRequest } from "../context";
import type { Invocation } from "./engine";
import { reportEvent } from "./reporting";

export async function announceUrl(
  invocation: Invocation,
  request: OpenUrlRequest,
): Promise<OpenUrlOutcome> {
  reportEvent(invocation, {
    kind: "endpoint",
    name: request.message,
    url: request.url,
  });
  const open = invocation.runtime.openUrl;
  if (!invocation.state.interactive || open === undefined) {
    return { opened: false };
  }
  try {
    await open(request.url);
    return { opened: true };
  } catch {
    return { opened: false };
  }
}
