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
} from "../args";
export type { CommandFamily, MountedTree } from "../command-family";
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
export type {
  CompletedEnvelope,
  ErroredEnvelope,
  StreamEvent,
  StreamMeta,
} from "../envelopes";
export type { EngineEvent, LogLevel, Severity } from "../events";
export { createTestCli } from "../execution/harness";
export { createCli } from "../execution/run";
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
export {
  type Cli,
  type HostProcess,
  type LoadedConfig,
  PRISMA_CONFIG_VERSION,
  type Runtime,
  type TestCli,
} from "../runtime";
export type { InputStream, OutputStream } from "../streams";
