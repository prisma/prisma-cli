/**
 * The v8 engine surface (R3): everything a product package imports for
 * CLI purposes — definition constructors, flag/positional builders, the
 * context/envelope/runtime types (re-exported from ./core), and the
 * createCli/createTestCli entry points (execution machinery lives in
 * ./execution).
 *
 * Normative source: .drive/projects/prisma-cli-v8/assets/engine/
 * engine-interface-draft.ts (v8).
 */
import { loadConfigImpl, stampConfigMarker } from "./config-loader";
import type {
  Cli,
  Credentials,
  LoadedConfig,
  MountedTree,
  ProductManifest,
  TestCli,
} from "./core";
import { buildEngine, createTestCliImpl } from "./execution";

export {
  type AnyCommand,
  type Args,
  type ArgsSpec,
  type Block,
  type Char,
  type Cli,
  type CommandContext,
  type CommandDefinition,
  type CommandHandler,
  type CompletedEnvelope,
  type ConfigSection,
  type Credentials,
  defineCommand,
  defineConfigSection,
  defineServerCommand,
  defineSessionCommand,
  type EngineEvent,
  type ErroredEnvelope,
  FLAG,
  type FlagSpec,
  type Format,
  flag,
  type Handler,
  type HelpSpec,
  type InputStream,
  type LoadedConfig,
  type LogLevel,
  type MountedTree,
  type NeedsSpec,
  type Outcome,
  type OutputStream,
  POSITIONAL,
  type PositionalSpec,
  PRESENTED,
  PRISMA_CONFIG_VERSION,
  type Presentations,
  type PresentedResult,
  type ProductManifest,
  type PromptSurface,
  positional,
  type Runtime,
  type SectionValidation,
  type ServerCommandDefinition,
  type SessionCommandDefinition,
  type Severity,
  type StreamEvent,
  type StreamMeta,
  type TestCli,
  type TreeNode,
  type Ui,
} from "./core";

/**
 * Shell-side construction. Group help is declared with the mount.
 * Collisions, unknown groups, reserved-flag violations, grammar
 * violations, and foreign-section references fail construction (build
 * time, not run time).
 */
export function createCli(spec: {
  readonly name: string;
  readonly version: string;
  readonly products: readonly ProductManifest[];
  readonly groups: Readonly<
    Record<string, { readonly brief: string; readonly description?: string }>
  >;
  readonly commands: MountedTree;
}): Cli {
  const engine = buildEngine(spec);
  return {
    run: (argv, runtime) => engine.execute(argv, runtime, {}),
  };
}

/**
 * Stamps the version marker on a prisma.config.ts export. Top-level keys
 * are the product config sections. Never throws — bad section values are
 * the section validator's problem, not defineConfig's.
 */
export function defineConfig<T extends Record<string, unknown>>(
  config: T,
): T & { readonly $prismaConfig: number } {
  return stampConfigMarker(config);
}

/**
 * The real-disk loader behind Runtime.config: reads prisma.config.ts
 * from cwd (cwd only — no walking up) and produces LoadedConfig. The
 * bin builds Runtime.config with this; tests hand in fixtures instead.
 */
export function loadConfig(cwd: string): Promise<LoadedConfig> {
  return loadConfigImpl(cwd);
}

// —————————————————————————————————————————————————————————————————————
// §11 The product-repo test harness — same machinery, bytes out (R7)
// —————————————————————————————————————————————————————————————————————

/**
 * The product-repo test harness: the same engine over in-memory streams.
 * The harness hands the engine no real process access at all, which is
 * how "the engine never calls process.exit and writes only to provided
 * streams" is proven by construction.
 */
export function createTestCli(spec: {
  readonly products?: readonly ProductManifest[];
  readonly commands: MountedTree;
  readonly groups?: Readonly<Record<string, { readonly brief: string }>>;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly credentials?: Credentials;
  readonly packageManager?: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  /** Fixed clock for deterministic stream timestamps. */
  readonly now?: () => Date;
}): TestCli {
  return createTestCliImpl(spec);
}
