/**
 * The v8 engine surface: everything a command-family package imports
 * for CLI purposes — definition constructors, flag/positional builders,
 * the context/envelope/runtime types, and the createCli entry point.
 * The test harness lives on the ./testing subpath.
 *
 * Normative source: .drive/projects/prisma-cli-v8/assets/engine/
 * engine-interface-draft.ts (v8).
 */

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
export { defineConfig, loadConfig } from "../config-loader";
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
  type HostProcess,
  type InputStream,
  type LoadedConfig,
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
