import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { AnyCommand } from "../commands";
import type { ConfigSection, SectionValidation } from "../config-section";
import type { Credentials } from "../context";
import { CliStructuredError, type Diagnostic } from "../protocol";
import type { Runtime } from "../runtime";
import type { Invocation } from "./engine";
import { firstLine, withDocsUrl, writeDiagnostic } from "./rendering";
import { SEVERITY_RANK } from "./reporting";

export type NeedsOutcome =
  | { readonly kind: "ok"; readonly config: unknown }
  | {
      readonly kind: "errored";
      readonly error: CliStructuredError;
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly kind: "bug"; readonly cause: unknown };

function needsErrored(
  error: CliStructuredError,
  diagnostics: readonly Diagnostic[] = [],
): NeedsOutcome {
  return { kind: "errored", error, diagnostics };
}

function structuredErrorFromDiagnostic(
  diagnostic: Diagnostic,
): CliStructuredError {
  return new CliStructuredError(diagnostic.code, diagnostic.summary, {
    severity: diagnostic.severity,
    why: diagnostic.why,
    nextActions: diagnostic.nextActions,
    where: diagnostic.where,
    meta: diagnostic.meta,
    docsUrl: diagnostic.docsUrl,
  });
}

/** The needs checks the engine enforces before the handler runs:
 *  interaction, dependencies, credentials, and the command's config
 *  section. File-level config problems fail only commands with a
 *  needs.config section — every other command runs normally. On
 *  success it carries the validated section value for ctx.config. */
export async function checkNeeds(
  def: AnyCommand,
  invocation: Invocation,
): Promise<NeedsOutcome> {
  const needs = def.needs;
  const failure =
    checkInteraction(needs, invocation) ??
    checkDependencies(needs, invocation) ??
    (await checkCredentials(needs, invocation));
  if (failure !== undefined) {
    return failure;
  }
  if (needs.config !== undefined) {
    return checkConfiguration(needs.config, invocation);
  }
  return { kind: "ok", config: undefined };
}

function checkInteraction(
  needs: AnyCommand["needs"],
  invocation: Invocation,
): NeedsOutcome | undefined {
  if (!needs.interaction || invocation.state.interactive) {
    return undefined;
  }
  return needsErrored(
    new CliStructuredError(
      "CLI.INTERACTION_REQUIRED",
      "This command requires an interactive terminal.",
      {
        why: "It prompts for input that cannot be supplied when the session is not interactive (no TTY stdin, CI, or --no-interactive).",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Run it from an interactive terminal, or pass --interactive.",
          },
        ],
      },
    ),
  );
}

function checkDependencies(
  needs: AnyCommand["needs"],
  invocation: Invocation,
): NeedsOutcome | undefined {
  for (const specifier of needs.dependencies) {
    if (!dependencyResolvable(specifier, invocation.runtime.cwd)) {
      return needsErrored(
        missingDependencyError(specifier, invocation.runtime.packageManager),
      );
    }
  }
  return undefined;
}

async function checkCredentials(
  needs: AnyCommand["needs"],
  invocation: Invocation,
): Promise<NeedsOutcome | undefined> {
  if (!needs.credentials) {
    return undefined;
  }
  let credentials: Credentials | undefined;
  try {
    credentials = await invocation.runtime.getCredentials();
  } catch (cause) {
    return needsErrored(
      new CliStructuredError(
        "CLI.CREDENTIALS_UNREADABLE",
        "The stored credentials could not be read.",
        {
          why: firstLine(
            cause instanceof Error ? cause.message : String(cause),
          ),
          nextActions: [
            {
              kind: "user-choice",
              label:
                "Sign in again to replace the stored credentials, then run the command again.",
            },
          ],
        },
      ),
    );
  }
  if (credentials === undefined) {
    return needsErrored(
      new CliStructuredError(
        "CLI.CREDENTIALS_REQUIRED",
        "You must be signed in to run this command.",
        {
          nextActions: [
            {
              kind: "user-choice",
              label: "Sign in, then run the command again.",
            },
          ],
        },
      ),
    );
  }
  return undefined;
}

function checkConfiguration(
  section: ConfigSection<unknown>,
  invocation: Invocation,
): NeedsOutcome {
  const fileLevel = invocation.runtime.config.diagnostics.filter(
    (entry) => entry.section === null,
  );
  if (fileLevel.length > 0) {
    return needsErrored(
      structuredErrorFromDiagnostic(fileLevel[0].diagnostic),
      fileLevel.slice(1).map((entry) => entry.diagnostic),
    );
  }
  return validateConfigSection(section, invocation);
}

/** Validates the command's needed config section. The validator
 *  owns absence (it receives undefined when the section is missing) and
 *  never throws — a throw is an engine-boundary bug, settled as one. */
function validateConfigSection(
  section: ConfigSection<unknown>,
  invocation: Invocation,
): NeedsOutcome {
  const raw = invocation.runtime.config.sections[section.name];
  let validation: SectionValidation<unknown>;
  try {
    validation = section.validate(raw);
  } catch (cause) {
    return {
      kind: "bug",
      cause: new Error(
        `@prisma/cli-engine: the '${section.name}' config section validator threw instead of returning diagnostics (a validator never throws)`,
        { cause },
      ),
    };
  }
  if (!validation.ok) {
    return needsErrored(
      new CliStructuredError(
        "CLI.CONFIG_INVALID",
        `The '${section.name}' section of prisma.config.ts is invalid.`,
        {
          nextActions: [
            {
              kind: "user-choice",
              label:
                "Fix the reported problems in that section, then run the command again.",
            },
          ],
        },
      ),
      validation.diagnostics,
    );
  }
  writeSectionWarnings(invocation, validation.diagnostics);
  return { kind: "ok", config: validation.value };
}

/** Diagnostics on an OK validation are warnings: written to stderr as
 *  commentary in both formats (stderr is free for commentary in json
 *  mode), filtered by the active log level, never added to the stream
 *  or the envelope. */
function writeSectionWarnings(
  invocation: Invocation,
  diagnostics: readonly Diagnostic[],
): void {
  const state = invocation.state;
  for (const diagnostic of diagnostics) {
    if (SEVERITY_RANK[diagnostic.severity] > SEVERITY_RANK[state.logLevel]) {
      continue;
    }
    writeDiagnostic(invocation.runtime.stderr, withDocsUrl(state, diagnostic));
  }
}

export function dependencyResolvable(specifier: string, cwd: string): boolean {
  try {
    createRequire(resolve(cwd, "__cli_engine_probe__.js")).resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

function installCommand(
  packageManager: Runtime["packageManager"],
  specifier: string,
): string | undefined {
  switch (packageManager) {
    case "npm":
      return `npm install ${specifier}`;
    case "pnpm":
      return `pnpm add ${specifier}`;
    case "yarn":
      return `yarn add ${specifier}`;
    case "bun":
      return `bun add ${specifier}`;
    case "unknown":
      return undefined;
  }
}

/** Optional peer dependencies: the engine probes and phrases. */
export function missingDependencyError(
  specifier: string,
  packageManager: Runtime["packageManager"],
): CliStructuredError {
  const install = installCommand(packageManager, specifier);
  return new CliStructuredError(
    "CLI.MISSING_DEPENDENCY",
    `This command requires the optional dependency '${specifier}', which is not installed in this project.`,
    {
      nextActions: [
        install === undefined
          ? {
              kind: "user-choice",
              label: `Install '${specifier}' with your package manager, then run the command again.`,
            }
          : {
              kind: "run-command",
              label: `Install '${specifier}'`,
              command: install,
            },
      ],
      meta: {
        specifier,
        ...(install === undefined ? {} : { installCommand: install }),
      },
    },
  );
}
