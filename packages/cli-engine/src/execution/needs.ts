import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { AnyCommand } from "../commands";
import { CONFIG_FILE_NAME } from "../config-loader";
import { resolveSectionOverChain } from "../config-merge";
import type { ConfigSection, SectionValidation } from "../config-section";
import { credentialsRequiredError } from "../credential-errors";
import type { ActiveCredential } from "../credential-manager";
import {
  installCommand,
  type PackageManagerId,
  resolvePackageManager,
} from "../package-manager";
import { CliStructuredError, type Diagnostic } from "../protocol";
import type { LoadedConfig, LoadedConfigFile } from "../runtime";
import type { Invocation } from "./engine";
import { makePaint } from "./palette";
import { withDocsUrl, writeDiagnostic } from "./rendering";
import { SEVERITY_RANK } from "./reporting";

/**
 * A child receives an access-token snapshot it cannot refresh. Before
 * the handler runs, a stored OAuth session inside this window is
 * refreshed by the parent; a credential that cannot refresh is refused.
 * The timing matters because pre-spawn work can create platform resources.
 */
export const CREDENTIAL_NEAR_EXPIRY_MS = 5 * 60_000;

export type NeedsOutcome =
  | {
      readonly kind: "ok";
      readonly config: unknown;
      /** The chain the config check loaded, for ctx.configFiles; empty
       *  when the command has no config need. */
      readonly configFiles: readonly LoadedConfigFile[];
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
    checkInteraction(needs, invocation) ??
    (await checkDependencies(needs, invocation));
  if (failure !== undefined) {
    return failure;
  }
  const credentials = await checkCredentials(needs, invocation);
  if (credentials.failure !== undefined) {
    return credentials.failure;
  }
  if (needs.config !== undefined) {
    const outcome = await checkConfiguration(needs.config, invocation);
    return outcome.kind === "ok"
      ? { ...outcome, spawnCredential: credentials.spawnCredential }
      : outcome;
  }
  return {
    kind: "ok",
    config: undefined,
    configFiles: [],
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

async function checkDependencies(
  needs: AnyCommand["needs"],
  invocation: Invocation,
): Promise<NeedsOutcome | undefined> {
  const runtime = invocation.runtime;
  const missing = needs.dependencies.find(
    (specifier) => !dependencyResolvable(specifier, runtime.cwd),
  );
  if (missing === undefined) {
    return undefined;
  }
  const manager = await resolvePackageManager({
    cwd: runtime.cwd,
    env: runtime.env,
    host: runtime.packageManager,
  });
  return needsErrored(missingDependencyError(missing, manager));
}

/**
 * The credentials need, single-sourced from the credential manager:
 * activeCredential() is the local-only truth (the process pin), and
 * its structured errors (sessions held none selected, blank env token)
 * pass through verbatim so the needs check, ctx.activeCredential, and
 * ctx.api raise identically. A host with no manager wired has no
 * credentials at all.
 *
 * The `"child"` form resolves the same credential ONCE and prepares an
 * access-token snapshot before the handler runs. A refreshable stored
 * OAuth session inside the near-expiry window is rotated and persisted;
 * an unrefreshable credential is refused. This happens before the
 * handler because work preceding a spawn may create platform resources.
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
  try {
    const accessToken = await manager.activeAccessToken({
      minimumValidityMs: CREDENTIAL_NEAR_EXPIRY_MS,
      now: invocation.now(),
      signal: invocation.signal,
    });
    if (accessToken === null) {
      return {
        failure: needsErrored(credentialsRequiredError("session-ended")),
      };
    }
    return { spawnCredential: credential };
  } catch (cause) {
    if (CliStructuredError.is(cause)) {
      return { failure: needsErrored(cause) };
    }
    throw cause;
  }
}

/**
 * A top-level key in the config file that is not one of the sections
 * the mounted commands and command families declare. The set is closed,
 * so an unrecognised key is a typo or a leftover, and staying silent
 * would mean quietly ignoring settings the user wrote.
 *
 * The check is the engine's rather than the loader's because the loader
 * is a Runtime member a host supplies: a check on the far side of that
 * seam holds only for as long as every host writes one.
 */
function unknownSectionDiagnostic(
  path: string,
  key: string,
  configSections: readonly string[],
): Diagnostic {
  return {
    code: "CLI.CONFIG_UNKNOWN_SECTION",
    severity: "error",
    summary: `${path} has a top-level key '${key}', which is not a config section this CLI recognises.`,
    why: `The sections this CLI recognises are: ${[...configSections].sort().join(", ")}.`,
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Remove the key, or rename it to one of the recognised section names.",
      },
    ],
    where: { path },
  };
}

/** Every file on the chain is checked — a typo'd key in a nested file
 *  errors even when the command's section resolved elsewhere. */
function unknownSections(
  loaded: LoadedConfig,
  configSections: readonly string[],
): readonly Diagnostic[] {
  const declared = new Set(configSections);
  return loaded.files.flatMap((file) =>
    Object.keys(file.sections)
      .filter((key) => !declared.has(key))
      .map((key) => unknownSectionDiagnostic(file.path, key, configSections)),
  );
}

/** The config file is read HERE and nowhere else, so a command with no
 *  needs.config never touches it. The file `--config` named travels on
 *  the run state; the closed set of section names comes from the
 *  mounted command families, and every key outside it is reported here
 *  whatever the loader did or did not check. */
async function checkConfiguration(
  section: ConfigSection<unknown>,
  invocation: Invocation,
): Promise<NeedsOutcome> {
  const configPath = invocation.state.configPath;
  const loaded = await invocation.runtime.loadConfig(configPath);
  const fileLevel = [
    ...loaded.diagnostics
      .filter((entry) => entry.section === null)
      .map((entry) => entry.diagnostic),
    ...unknownSections(loaded, invocation.configSections),
  ];
  if (fileLevel.length > 0) {
    return needsErrored(
      structuredErrorFromDiagnostic(fileLevel[0]),
      fileLevel.slice(1),
    );
  }
  return validateConfigSection(section, loaded, invocation);
}

/** Validates the command's needed config section, resolved per key over
 *  the chain nearest-first. The validator owns absence (it receives
 *  undefined when no file declares the section) and never throws — a
 *  throw is an engine-boundary bug, settled as one. */
function validateConfigSection(
  section: ConfigSection<unknown>,
  loaded: LoadedConfig,
  invocation: Invocation,
): NeedsOutcome {
  const resolved = resolveSectionOverChain(section, loaded.files);
  if (!resolved.ok) {
    return needsErrored(
      sectionUnreadableError(section.name, resolved.file, resolved.cause),
    );
  }
  let validation: SectionValidation<unknown>;
  try {
    validation = section.validate(resolved.value);
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
      sectionInvalidError(section.name, resolved.contributors, loaded.files),
      validation.diagnostics,
    );
  }
  writeSectionWarnings(invocation, validation.diagnostics);
  return {
    kind: "ok",
    config: validation.value,
    configFiles: loaded.files,
    spawnCredential: undefined,
  };
}

/** A property getter in a section's value is user code; a throw while
 *  reading it is a config error naming the file, never an engine bug. */
function sectionUnreadableError(
  name: string,
  file: string,
  cause: unknown,
): CliStructuredError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new CliStructuredError(
    "CLI.CONFIG_SECTION_INVALID",
    `The '${name}' section of ${file} is invalid: reading its value threw '${message.split("\n", 1)[0].trim()}'.`,
    {
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Fix the reported problems in that section, then run the command again.",
        },
      ],
    },
  );
}

/** Provenance decides which file the error names: the one declaring
 *  file, the nearest of several with the chain listed, or — when no
 *  file declares the section at all — the fact that it is missing. */
function sectionInvalidError(
  name: string,
  contributors: readonly LoadedConfigFile[],
  files: readonly LoadedConfigFile[],
): CliStructuredError {
  const fix = {
    kind: "user-choice" as const,
    label:
      "Fix the reported problems in that section, then run the command again.",
  };
  if (contributors.length === 1) {
    return new CliStructuredError(
      "CLI.CONFIG_SECTION_INVALID",
      `The '${name}' section of ${contributors[0].path} is invalid.`,
      { nextActions: [fix] },
    );
  }
  if (contributors.length > 1) {
    const paths = contributors.map((file) => file.path);
    const parents =
      paths.length === 2 ? "its parent config file" : "its parent config files";
    return new CliStructuredError(
      "CLI.CONFIG_SECTION_INVALID",
      `The '${name}' section, merged from ${paths[0]} and ${parents}, is invalid.`,
      {
        why: `The resolved section combines these files, nearest first: ${paths.join(", ")}.`,
        nextActions: [fix],
      },
    );
  }
  const target = files[0]?.path ?? CONFIG_FILE_NAME;
  return new CliStructuredError(
    "CLI.CONFIG_SECTION_INVALID",
    `The '${name}' section is missing: ${
      files.length === 0
        ? "no config file was found"
        : "no loaded config file declares it"
    }.`,
    {
      why:
        files.length === 0
          ? undefined
          : `Config files loaded, nearest first: ${files.map((file) => file.path).join(", ")}.`,
      nextActions: [
        {
          kind: "user-choice",
          label: `Declare the '${name}' section in ${target}, then run the command again.`,
        },
      ],
    },
  );
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
    writeDiagnostic(
      invocation.runtime.stderr,
      withDocsUrl(state, diagnostic),
      makePaint(state.colorEnabled),
    );
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

/** Optional peer dependencies: the engine probes and phrases. */
export function missingDependencyError(
  specifier: string,
  manager: PackageManagerId,
): CliStructuredError {
  const install = installCommand(manager, { packages: [specifier] }).line;
  return new CliStructuredError(
    "CLI.MISSING_DEPENDENCY",
    `This command requires the optional dependency '${specifier}', which is not installed in this project.`,
    {
      nextActions: [
        {
          kind: "run-command",
          label: `Install '${specifier}'`,
          command: install,
        },
      ],
      meta: { specifier, installCommand: install },
    },
  );
}
