/** Presentation shared by the `telemetry enable|disable` consent
 *  commands: one confirmation line, echoed on stdout, with the raw
 *  decision as the json result. */
import type { Presentations } from "@prisma/cli-engine";

export function consentPresentations(
  line: string,
  json: unknown,
): Presentations {
  return {
    human: () => [{ kind: "summary", tone: "ok", text: line }],
    stdout: () => [line],
    json: () => json,
  };
}
