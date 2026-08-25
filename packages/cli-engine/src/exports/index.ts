/**
 * The engine surface: everything a command-family package imports
 * for CLI purposes — definition constructors, flag/positional builders,
 * the context/envelope/runtime types, and the createCli entry point.
 * The test harness lives on the ./testing subpath.
 */

export { readActiveAccessToken } from "../active-access-token";
export {
  type Args,
  type ArgsSpec,
  type Char,
  type CommandArgs,
  type FlagSpec,
  flag,
  type PositionalSpec,
  positional,
} from "../args";
/** ci-info's CI detection over the given env only — never process.env. */
export { detectCI } from "../ci";
export { type Cli, type CliRunHooks, createCli } from "../cli";
export {
  type CommandFamily,
  type CommandRedirect,
  defineCommandFamily,
  type MountedTree,
  type RedirectSpec,
} from "../command-family";
export {
  type AnyCommand,
  type CommandDefinition,
  type CommandHandler,
  type CommandHelp,
  type CommandNeeds,
  type CompletedEnvelope,
  defineCommand,
  defineServerCommand,
  defineSessionCommand,
  type ErroredEnvelope,
  type Handler,
  type HelpSpec,
  type NeedsSpec,
  type ServerCommandDefinition,
  type SessionCommandDefinition,
  type SpawnDeclarations,
} from "../commands";
export {
  definePrismaConfig,
  loadConfig,
} from "../config-loader";
export {
  type ResolvedSection,
  resolveSectionOverChain,
  resolveSectionPath,
  type SectionProvenance,
  sectionProvenance,
} from "../config-merge";
export {
  type ConfigSection,
  defineConfigSection,
  type SectionValidation,
} from "../config-section";
export type {
  BrowserWaitRequest,
  CommandContext,
  OpenUrlOutcome,
  OpenUrlRequest,
  PromptSurface,
} from "../context";
export {
  authServiceError,
  type CredentialsRequiredReason,
  credentialRejectedError,
  credentialsRequiredError,
  credentialWorkspaceMismatchError,
  emptyServiceTokenError,
  noSessionForWorkspaceError,
} from "../credential-errors";
export {
  type ActiveAccessTokenOptions,
  type ActiveCredential,
  type Credential,
  type CredentialIdentity,
  type CredentialManager,
  type CredentialOrigin,
  SERVICE_TOKEN_ENV_VAR,
  type Session,
  type StoredSessions,
} from "../credential-manager";
export { EnvironmentCredentialManager } from "../environment-credential-manager";
export type {
  EngineEvent,
  Severity,
  StreamEvent,
  StreamMeta,
} from "../events";
export type {
  CredentialRefresher,
  CredentialRefreshResult,
  ManagementApiClient,
  ManagementApiClientConfig,
  TokenStorage,
} from "../management-api";
export type {
  PackageManagerId,
  PackageManagerRunner,
  PackageManagerRunRequest,
  PackageManagerRunResult,
  PackageOperations,
} from "../package-manager";
export {
  type Block,
  type Format,
  type Outcome,
  PRESENTED,
  type Presentations,
  type PresentedResult,
  type Span,
  type Status,
  type Text,
  type Tone,
  type TreeNode,
  type Ui,
} from "../presentation";
export type { EngineCommandSnapshot, RunSummary } from "../run-summary";
export {
  type Host,
  type HostProcess,
  type InputStream,
  type LoadedConfig,
  type LoadedConfigFile,
  type OutputStream,
  PRISMA_CONFIG_VERSION,
  type Runtime,
} from "../runtime";
export {
  type ChildResult,
  type ChildStatusSettlement,
  type ExitWithChildStatusOptions,
  exitWithChildStatus,
  type SpawnChild,
  type SpawnedChild,
  type SpawnOptions,
  type SpawnRequest,
} from "../spawn";
export {
  type TelemetryStatus,
  telemetryCommandGroup,
} from "../telemetry/commands";
export type { TelemetryStatusReason } from "../telemetry/gating";
export type { TelemetryPayload } from "../telemetry/payload";
export type { TelemetryDeclaration } from "../telemetry/report";
export {
  claimedExpiresAt,
  claimedIdentity,
  credentialWorkspaceId,
} from "../token-claims";
