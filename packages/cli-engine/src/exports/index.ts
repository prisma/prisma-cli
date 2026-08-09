/**
 * The v8 engine surface (R3): everything a command-family package
 * imports for CLI purposes — definition constructors, flag/positional
 * builders, the context/envelope/runtime types, and the
 * createCli/createTestCli entry points.
 *
 * Normative source: .drive/projects/prisma-cli-v8/assets/engine/
 * engine-interface-draft.ts (v8).
 */
export {
  type Args,
  type ArgsSpec,
  type Char,
  FLAG,
  type FlagSpec,
  flag,
  POSITIONAL,
  type PositionalSpec,
  positional,
} from "../definition/args";
export type { CommandFamily, MountedTree } from "../definition/command-family";
export {
  type AnyCommand,
  type CommandDefinition,
  type CommandHandler,
  defineCommand,
  defineServerCommand,
  defineSessionCommand,
  type Handler,
  type HelpSpec,
  type NeedsSpec,
  type ServerCommandDefinition,
  type SessionCommandDefinition,
} from "../definition/commands";
export {
  type ConfigSection,
  defineConfigSection,
  type SectionValidation,
} from "../definition/config-section";
export type {
  CommandContext,
  Credentials,
  PromptSurface,
} from "../definition/context";
export type {
  CompletedEnvelope,
  ErroredEnvelope,
  StreamEvent,
  StreamMeta,
} from "../definition/envelopes";
export type { EngineEvent, LogLevel, Severity } from "../definition/events";
export {
  type Block,
  type Format,
  type Outcome,
  PRESENTED,
  type Presentations,
  type PresentedResult,
  type TreeNode,
  type Ui,
} from "../definition/presentation";
export {
  type Cli,
  type LoadedConfig,
  PRISMA_CONFIG_VERSION,
  type Runtime,
  type TestCli,
} from "../definition/runtime";
export type { InputStream, OutputStream } from "../definition/streams";
export { defineConfig, loadConfig } from "../config-loader";
export { createTestCli } from "../execution/harness";
export { createCli } from "../execution/run";
