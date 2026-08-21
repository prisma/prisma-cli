/**
 * The legacy error mapper's two spellings of the binary name.
 *
 * Ported copy was written when the binary was called `prisma-cli`, and
 * `fromLegacyCliError` renames it — turning `<name> app …` into
 * `<name> service …` and each command line in `nextSteps` into a
 * run-command action. Producers are being modernised one at a time
 * (`computeConfigErrorToCliError` already writes the current name,
 * `formatDomainFailureFix` still writes the legacy one), so the mapper
 * has to recognise both. It is not symmetrical: a line it fails to
 * recognise is DROPPED from nextActions rather than passed through, so
 * an unrecognised spelling costs the user their next step silently.
 *
 * `service-compute-config.test.ts` and `service-domain-wait.test.ts`
 * drive this through real commands. These tests drive the mapper
 * directly, one spelling each, so a regression names the mapper.
 */
import { describe, expect, it } from "vitest";

import {
  fromLegacyCliError,
  renameAppCopy,
} from "../src/commands/service/errors";
import { CliError } from "../src/errors";

function legacyError(options: {
  fix?: string;
  nextSteps?: string[];
  why?: string;
}): CliError {
  return new CliError({
    code: "COMPUTE_CONFIG_INVALID",
    domain: "app",
    summary: "Multiple compute config files found",
    why: options.why ?? null,
    fix: options.fix ?? null,
    nextSteps: options.nextSteps ?? [],
  });
}

function commandsOf(error: {
  nextActions: ReadonlyArray<{ kind: string; command?: string }>;
}): string[] {
  return error.nextActions
    .filter((action) => action.kind === "run-command")
    .map((action) => action.command as string);
}

describe("renaming ported copy", () => {
  it("renames the app noun in copy written with the legacy name", () => {
    expect(renameAppCopy("Run prisma-cli app domain retry example.com.")).toBe(
      "Run prisma service domain retry example.com.",
    );
  });

  it("renames the app noun in copy written with the current name", () => {
    expect(renameAppCopy("Run prisma app domain retry example.com.")).toBe(
      "Run prisma service domain retry example.com.",
    );
  });
});

describe("mapping a legacy error's next steps", () => {
  it("keeps a command line written with the legacy name, renamed", () => {
    const mapped = fromLegacyCliError(
      legacyError({ nextSteps: ["prisma-cli app domain retry example.com"] }),
    );

    expect(commandsOf(mapped)).toEqual([
      "prisma service domain retry example.com",
    ]);
  });

  it("keeps a command line written with the current name", () => {
    const mapped = fromLegacyCliError(
      legacyError({ nextSteps: ["prisma app domain retry example.com"] }),
    );

    expect(commandsOf(mapped)).toEqual([
      "prisma service domain retry example.com",
    ]);
  });

  it("drops a line that names no binary at all", () => {
    const mapped = fromLegacyCliError(
      legacyError({ nextSteps: ["ask an administrator for access"] }),
    );

    expect(commandsOf(mapped)).toEqual([]);
  });
});
