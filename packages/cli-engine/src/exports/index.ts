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
  defineCommandFamily,
  type MountedTree,
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
} from "../commands";
export { defineConfig, loadConfig } from "../config-loader";
export {
  type ConfigSection,
  defineConfigSection,
  type SectionValidation,
} from "../config-section";
export type {
  CommandContext,
  Credentials,
  PromptSurface,
} from "../context";
export {
  authServiceError,
  credentialsRequiredError,
  type CredentialsRequiredReason,
  environmentSessionMutationError,
} from "../credential-errors";
export type {
  Credential,
  CredentialManager,
  GrantSummary,
  Identity,
  Session,
  Workspace,
} from "../credential-manager";
export type {
  EngineEvent,
  Severity,
  StreamEvent,
  StreamMeta,
} from "../events";
export type { ManagementApiClient } from "../management-api";
export {
  type Block,
  type Format,
  type Outcome,
  PRESENTED,
  type Presentations,
  type PresentedResult,
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
