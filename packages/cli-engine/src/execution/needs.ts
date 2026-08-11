import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { AnyCommand } from "../commands";
import type { ConfigSection, SectionValidation } from "../config-section";
import { credentialsRequiredError } from "../credential-errors";
import type { ActiveCredential } from "../credential-manager";
import { CliStructuredError, type Diagnostic } from "../protocol";
import type { Runtime } from "../runtime";
import type { Invocation } from "./engine";
import { withDocsUrl, writeDiagnostic } from "./rendering";
import { SEVERITY_RANK } from "./reporting";

/**
 * D1 ruling (S3): a session expiring within this window is refused
 * before the handler runs. The child receives a snapshot of the token
 * and cannot refresh it, and the in-process work that precedes the
 * spawn creates platform resources, so the refusal has to come first.
 */
export const CREDENTIAL_NEAR_EXPIRY_MS = 5 * 60_000;

export type NeedsOutcome =
  | {
      readonly kind: "ok";
      readonly config: unknown;
      /** The credential resolved for a `credentials: "child"` command,
       *  carried forward so the spawn path never re-resolves it. */
      readonly spawnCredential: ActiveCredential | undefined;
    }
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
    checkInteraction(needs, invocation) ?? checkDependencies(needs, invocation);
  if (failure !== undefined) {
    return failure;
  }
  const credentials = await checkCredentials(needs, invocation);
  if (credentials.failure !== undefined) {
    return credentials.failure;
  }
  if (needs.config !== undefined) {
    const outcome = checkConfiguration(needs.config, invocation);
    return outcome.kind === "ok"
      ? { ...outcome, spawnCredential: credentials.spawnCredential }
      : outcome;
  }
  return {
    kind: "ok",
    config: undefined,
    spawnCredential: credentials.spawnCredential,
  };
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

/**
 * The credentials need, single-sourced from the credential manager:
 * activeCredential() is the local-only truth (the process pin), and
 * its structured errors (sessions held none selected, blank env token)
 * pass through verbatim so the needs check, ctx.activeCredential, and
 * ctx.api raise identically. A host with no manager wired has no
 * credentials at all.
 *
 * The `"child"` form resolves the same credential ONCE, additionally
 * refuses a session about to expire — before the handler runs, not
 * before the spawn: the work that precedes a spawn creates real
 * platform resources, and the child cannot refresh the snapshot it is
 * given — and carries the credential forward for the spawn path.
 */
async function checkCredentials(
  needs: AnyCommand["needs"],
  invocation: Invocation,
): Promise<{
  readonly failure?: NeedsOutcome;
  readonly spawnCredential?: ActiveCredential;
}> {
  if (needs.credentials === false) {
    return {};
  }
  const manager = invocation.runtime.credentialManager;
  if (manager === undefined) {
    return { failure: needsErrored(credentialsRequiredError()) };
  }
  let credential: ActiveCredential | null;
  try {
    credential = await manager.activeCredential();
  } catch (cause) {
    if (CliStructuredError.is(cause)) {
      return { failure: needsErrored(cause) };
    }
    throw cause;
  }
  if (credential === null) {
    return { failure: needsErrored(credentialsRequiredError()) };
  }
  if (needs.credentials !== "child") {
    return {};
  }
  const expiry = nearExpiryFailure(credential, invocation);
  return expiry === undefined
    ? { spawnCredential: credential }
    : { failure: expiry };
}

function nearExpiryFailure(
  credential: ActiveCredential,
  invocation: Invocation,
): NeedsOutcome | undefined {
  if (credential.expiresAt === undefined) {
    return undefined;
  }
  const remainingMs =
    credential.expiresAt.getTime() - invocation.now().getTime();
  if (remainingMs > CREDENTIAL_NEAR_EXPIRY_MS) {
    return undefined;
  }
  return needsErrored(credentialsRequiredError("expiring-soon"));
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
  return { kind: "ok", config: validation.value, spawnCredential: undefined };
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
