/**
 * Permanent type-tests for the compile-verified claims in
 * .drive/projects/prisma-cli-v8/assets/engine/reviews/
 * code-review-r4-closure.md (r4) and code-review-r5-delta.md (r5).
 * Checked by `tsc --noEmit`; never executed. Stale @ts-expect-error
 * directives fail the build (TS2578).
 */
import type {
  ActiveCredential,
  Char,
  CommandContext,
  CommandFamily,
  CommandHandler,
  CompletedEnvelope,
  ConfigSection,
  CredentialManager,
  EngineEvent,
  ErroredEnvelope,
  FlagSpec,
  InputStream,
  LoadedConfig,
  MountedTree,
  Presentations,
  PresentedResult,
  Runtime,
  SectionValidation,
  Session,
  StreamEvent,
} from "@prisma/cli-engine";
import {
  type createCli,
  defineCommand,
  defineConfigSection,
  defineServerCommand,
  defineSessionCommand,
  flag,
  positional,
} from "@prisma/cli-engine";
import type {
  CliStructuredError,
  Diagnostic,
  Result,
} from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import type { createTestCli } from "@prisma/cli-engine/testing";

type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

// —————————————————————————————————————————————————————————————————————
// Claim r4(a): Char alias mechanics
// —————————————————————————————————————————————————————————————————————

// r4(a): Char<'q'> is 'q' — single character accepted
export const charSingle: Char<"q"> = "q";
// r4(a): Char<'ab'> is never — multi-character rejected
export const charMulti: MutuallyAssignable<Char<"ab">, never> = true;
// r4(a): Char<''> is never — empty string rejected
export const charEmpty: MutuallyAssignable<Char<"">, never> = true;
// r4(a): Char<'data-proxy'> is never — word alias rejected
export const charWord: MutuallyAssignable<Char<"data-proxy">, never> = true;

// r4(a): single-character alias compiles on builders
export const aliasedBoolean = flag.boolean({ brief: "force", alias: "f" });
export const aliasedString = flag.string({ brief: "query", alias: "q" });
// r4(a): omitting the alias compiles (the `= never` default does not poison the call)
export const unaliasedBoolean = flag.boolean({ brief: "force" });
// r4(a): enum inference survives the added alias parameter
export const enumFlag: FlagSpec<"a" | "b" | undefined> = flag.enum({
  brief: "mode",
  values: ["a", "b"],
  alias: "F",
});

// Args specs are phantom-typed, not symbol-branded: the carrier is a
// never-assigned optional property, and inference still flows from the
// builders into handler-visible types (asserted in runCheck below).

// @ts-expect-error r4(a): multi-character alias 'ab' is rejected
export const multiAlias = flag.boolean({ brief: "force", alias: "ab" });
// @ts-expect-error r4(a): empty-string alias is rejected
export const emptyAlias = flag.string({ brief: "query", alias: "" });
// @ts-expect-error r4(a): word alias 'data-proxy' is rejected
export const wordAlias = flag.string({ brief: "proxy", alias: "data-proxy" });

// —————————————————————————————————————————————————————————————————————
// Claim r5(2): needs.config → ctx.config inference through the grouped
// needs, via the full round trip (defineCommand → CommandHandler →
// ctx.present); claims r4(b)/r5(1): exitCode required iff catalogued
// —————————————————————————————————————————————————————————————————————

interface CheckCfg {
  readonly strict: boolean;
}

export const checkSection: ConfigSection<CheckCfg> = defineConfigSection({
  name: "check",
  validate: (raw): SectionValidation<CheckCfg> =>
    raw === undefined
      ? { ok: true, value: { strict: false }, diagnostics: [] }
      : { ok: true, value: { strict: true }, diagnostics: [] },
});

export const checkCommand = defineCommand({
  help: { summary: "Check the project" },
  args: {
    flags: {
      strict: flag.boolean({ brief: "fail on warnings" }),
      filter: flag.string({ brief: "limit scope", placeholder: "glob" }),
    },
    positionals: {
      name: positional.string({ brief: "target", placeholder: "name" }),
      rest: positional.variadic({ brief: "extras", placeholder: "extra" }),
    },
  },
  needs: { config: checkSection },
  exitCodes: { 4: "findings", 5: "fatal findings" },
  handler: null as never,
});

// defineCommand stamps the discriminant at the type level
export const resultKind: "result-command" = checkCommand.kind;

const diagnostic: Diagnostic = {
  code: "CHECK.FINDING",
  severity: "warn",
  summary: "A finding",
  nextActions: [],
};

const presentations: Presentations = { human: () => [] };

export const runCheck: CommandHandler<typeof checkCommand> = async (
  args,
  ctx,
) => {
  // Args machinery: declared flags/positionals map to handler-visible types
  const strict: boolean = args.flags.strict;
  const filter: string | undefined = args.flags.filter;
  const name: string = args.positionals.name;
  const rest: readonly string[] = args.positionals.rest;

  // r5(2): the config token in needs.config types ctx.config to the
  // section's validated type
  const cfg: CheckCfg = ctx.config;
  const strictCfg: boolean = ctx.config.strict;

  // r5(1)/r4(b): documented exit codes compile at every return site
  const p4 = ctx.present(
    { data: { strict, filter, name, rest }, exitCode: 4 },
    presentations,
  );
  const p5 = ctx.present({ data: cfg, exitCode: 5 }, presentations);
  const p0 = ctx.present({ data: strictCfg, exitCode: 0 }, presentations);
  // r5(1): diagnostics are optional alongside the exit code
  const pDiag = ctx.present(
    { data: name, exitCode: 4, diagnostics: [diagnostic] },
    presentations,
  );

  // @ts-expect-error r5(1): exitCode OMITTED on a catalogued command is rejected
  ctx.present({ data: name }, presentations);
  // @ts-expect-error r5(1)/r4(b): exitCode 7 is outside the catalogue {4, 5}
  ctx.present({ data: name, exitCode: 7 }, presentations);

  return ok(
    ctx.present({ data: [p4, p5, p0, pDiag], exitCode: 0 }, presentations),
  );
};

// —————————————————————————————————————————————————————————————————————
// Claims r5(1) uncatalogued direction and r5(3): no exitCodes → exitCode
// forbidden; no config need → ctx.config is undefined
// —————————————————————————————————————————————————————————————————————

export const plainCommand = defineCommand({
  help: { summary: "Plain command" },
  handler: null as never,
});

export const runPlain: CommandHandler<typeof plainCommand> = async (
  _args,
  ctx,
) => {
  // r5(3): with no needs.config, TConfig defaults to undefined
  const noConfig: undefined = ctx.config;

  // r5(1): present({ data }) compiles without an exit code
  const bare = ctx.present({ data: noConfig }, presentations);
  // r5(1): diagnostics still accepted without a catalogue
  const withDiagnostics = ctx.present(
    { data: 1, diagnostics: [] },
    presentations,
  );

  // @ts-expect-error r5(1): exitCode is FORBIDDEN when the command declares no exitCodes
  ctx.present({ data: 1, exitCode: 4 }, presentations);
  // @ts-expect-error r5(3): ctx.config is undefined without a config need — no property access
  const invalid = ctx.config.strict;

  return ok(
    ctx.present({ data: [bare, withDiagnostics, invalid] }, presentations),
  );
};

// —————————————————————————————————————————————————————————————————————
// Claim (r3 P02 lineage, restated in r5): the PresentedResult brand —
// only ctx.present produces one; hand-construction is a type error
// —————————————————————————————————————————————————————————————————————

// @ts-expect-error brand claim: a plain object literal lacks the PRESENTED brand
export const forgedPresented: PresentedResult<number> = {
  data: 1,
  exitCode: 0,
  diagnostics: [],
  presentation: { human: [], stdout: [], json: undefined, next: [] },
};

export const runForged: CommandHandler<typeof plainCommand> = async (
  _args,
  _ctx,
) => {
  // @ts-expect-error brand claim: a handler cannot return a plain object where a PresentedResult is required
  const forged: Result<PresentedResult<unknown>, CliStructuredError> = ok({
    data: 1,
    exitCode: 0,
    diagnostics: [],
    presentation: { human: [], stdout: [], json: undefined, next: [] },
  });
  return forged;
};

// PresentedResult.diagnostics is never undefined downstream
export const diagnosticsNeverUndefined: MutuallyAssignable<
  PresentedResult<number>["diagnostics"],
  readonly Diagnostic[]
> = true;
// PresentedResult.exitCode is always populated downstream
export const exitCodeNeverUndefined: MutuallyAssignable<
  PresentedResult<number>["exitCode"],
  number
> = true;

// —————————————————————————————————————————————————————————————————————
// Session and server definitions: discriminants stamped by constructors
// —————————————————————————————————————————————————————————————————————

export const devSession = defineSessionCommand({
  help: { summary: "Run the dev session" },
  handler: null as never,
});
export const sessionKind: "session-command" = devSession.kind;

export const lspServer = defineServerCommand({
  help: { summary: "Run the language server" },
  handler: null as never,
});
export const serverKind: "server-command" = lspServer.kind;

// A session context carries no exit-code catalogue: exitCode forbidden
export const sessionCtxCheck = (ctx: CommandContext<undefined>) => {
  // @ts-expect-error session/no-catalogue contexts reject exitCode at present
  return ctx.present({ data: 1, exitCode: 4 }, presentations);
};

// —————————————————————————————————————————————————————————————————————
// Mounting types: AnyCommand erasure, command families, createCli/createTestCli
// input shapes
// —————————————————————————————————————————————————————————————————————

export const tree: MountedTree = {
  "auth whoami": checkCommand,
  dev: devSession,
  lsp: lspServer,
};

export const commandFamily: CommandFamily = {
  configSection: checkSection,
  commands: { check: checkCommand, dev: devSession, lsp: lspServer },
  docsBaseUrl: "https://example.invalid/docs",
};

// Normalized definitions: every field is always present
export const normalizedHelp: MutuallyAssignable<
  (typeof checkCommand)["help"]["examples"],
  readonly string[]
> = true;
export const normalizedNeeds: MutuallyAssignable<
  (typeof plainCommand)["needs"]["dependencies"],
  readonly string[]
> = true;
export const normalizedArgs: {
  flags: Record<never, unknown>;
  positionals: Record<never, unknown>;
} = plainCommand.args;
export const normalizedExitCodes: Readonly<Record<never, string>> =
  plainCommand.exitCodes;

export const createCliSpec: Parameters<typeof createCli>[0] = {
  name: "prisma-v8",
  version: "0.0.0",
  commandFamilies: [commandFamily],
  groups: { auth: { brief: "Authentication" } },
  commands: tree,
};

export const createTestCliSpec: Parameters<typeof createTestCli>[0] = {
  commands: tree,
  config: { check: { strict: true } },
  managementApi: { baseUrl: "https://test.invalid" },
  packageManager: "pnpm",
  now: () => new Date(0),
};

// —————————————————————————————————————————————————————————————————————
// Envelopes and the flattened json stream
// —————————————————————————————————————————————————————————————————————

export const completedEnvelope: CompletedEnvelope<{ readonly user: string }> = {
  ok: true,
  commandId: "auth.whoami",
  result: { user: "someone" },
  exitCode: 0,
  diagnostics: [],
  nextActions: [],
};

export const erroredEnvelope: ErroredEnvelope = {
  ok: false,
  commandId: "auth.whoami",
  error: {
    code: "AUTH.NOT_LOGGED_IN",
    severity: "error",
    summary: "Not logged in",
    nextActions: [],
  },
  diagnostics: [diagnostic],
  nextActions: [
    { kind: "run-command", label: "Sign in", command: "prisma auth login" },
  ],
};

export const streamEvents: readonly StreamEvent[] = [
  {
    kind: "message",
    severity: "info",
    text: "checking",
    commandId: "auth.whoami",
    timestamp: "1970-01-01T00:00:00.000Z",
  },
  {
    kind: "result",
    envelope: completedEnvelope,
    commandId: "auth.whoami",
    timestamp: "1970-01-01T00:00:00.000Z",
  },
];

export const invalidMessage: EngineEvent = {
  kind: "message",
  // @ts-expect-error draft §1: 'error' is not a valid message severity — fatal problems are the Result's error
  severity: "error",
  text: "x",
};

// —————————————————————————————————————————————————————————————————————
// Runtime and LoadedConfig conformance
// —————————————————————————————————————————————————————————————————————

export const loadedConfig: LoadedConfig = {
  path: "/project/prisma.config.ts",
  sections: { check: { strict: true } },
  diagnostics: [{ section: null, diagnostic }],
};

export const runtimeShape: Runtime = {
  isCI: false,
  stdout: { write() {} },
  stderr: { write() {} },
  stdin: undefined as unknown as InputStream,
  cwd: "/",
  env: { CI: "1" },
  isTty: { stdin: true, stdout: true, stderr: true },
  exit: (code: number): never => {
    throw new Error(String(code));
  },
  onSignal: () => () => {},
  loadConfig: async (configPath?: string) =>
    configPath === undefined
      ? { path: "/project/prisma.config.ts", sections: {}, diagnostics: [] }
      : loadedConfig,
  managementApi: { baseUrl: "https://test.invalid" },
  packageManager: "pnpm",
};

// —————————————————————————————————————————————————————————————————————
// The credential manager surface (design rev 6, the active
// credential): managesCredentials is a capability —
// ctx.credentialManager exists exactly when declared;
// ctx.activeCredential exists on every context; the harness seeds a
// mutable in-memory manager.
// —————————————————————————————————————————————————————————————————————

export const managedCommand = defineCommand({
  help: { summary: "Operates on the credential machinery" },
  managesCredentials: true,
  handler: async (_args, ctx) => {
    const manager: CredentialManager = ctx.credentialManager;
    const active: ActiveCredential | null = await ctx.activeCredential();
    void manager;
    void active;
    return ok(ctx.present({ data: null }, { human: () => [] }));
  },
});
export const managedIsDeclared: true = managedCommand.managesCredentials;

export const unmanagedCommand = defineCommand({
  help: { summary: "Ordinary command" },
  handler: async (_args, ctx) => {
    const active: ActiveCredential | null = await ctx.activeCredential();
    void active;
    // @ts-expect-error the capability was not declared, so the context carries no credentialManager
    void ctx.credentialManager;
    return ok(ctx.present({ data: null }, { human: () => [] }));
  },
});
export const unmanagedIsUndeclared: false = unmanagedCommand.managesCredentials;

export const sessionHasNoTokenMaterial:
  | "workspaceId"
  | "workspaceName"
  | "expiresAt" = undefined as unknown as keyof Session;

export const activeCredentialHasNoTokenMaterial:
  | "workspaceId"
  | "workspaceName"
  | "expiresAt"
  | "identity"
  | "origin" = undefined as unknown as keyof ActiveCredential;

export const seededHarnessSpec: Parameters<typeof createTestCli>[0] = {
  commands: tree,
  credential: {
    token: "jwt",
    refreshToken: undefined,
    expiresAt: undefined,
  },
  sessions: [
    {
      workspaceId: "workspace-1",
      workspaceName: "Acme",
      credential: {
        token: "jwt",
        refreshToken: undefined,
        expiresAt: undefined,
      },
    },
  ],
  selectedWorkspaceId: "workspace-1",
  environmentCredential: {
    token: "jwt",
    refreshToken: undefined,
    expiresAt: undefined,
  },
  managementApiClientConfig: {
    clientId: "client",
    redirectUri: "https://test.invalid/cb",
    apiBaseUrl: "https://api.test.invalid",
    authBaseUrl: "https://auth.test.invalid",
  },
};

export const runtimeWithManager: Runtime = {
  ...runtimeShape,
  credentialManager: undefined as unknown as CredentialManager,
  managementApiClientConfig: {
    clientId: "client",
    redirectUri: "https://test.invalid/cb",
    apiBaseUrl: "https://api.test.invalid",
    authBaseUrl: "https://auth.test.invalid",
  },
};
