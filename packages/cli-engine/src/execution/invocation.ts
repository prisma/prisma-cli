import type { CommandFamily, MountedTree } from "../definition/command-family";
import type { StreamEvent } from "../definition/envelopes";
import type { EngineEvent, LogLevel } from "../definition/events";
import type { Format, PresentedResult } from "../definition/presentation";
import type { Runtime } from "../definition/runtime";

export interface EngineSpec {
  readonly name: string;
  readonly version: string;
  readonly commandFamilies: readonly CommandFamily[];
  readonly groups: Readonly<
    Record<string, { readonly brief: string; readonly description?: string }>
  >;
  readonly commands: MountedTree;
}

export interface RunHooks {
  readonly onEvent?: (event: EngineEvent) => void;
  readonly onPresented?: (presented: PresentedResult<unknown>) => void;
  readonly onStreamEvent?: (frame: StreamEvent) => void;
  readonly answers?: ReadonlyArray<string | boolean>;
}

export interface Engine {
  execute(
    argv: readonly string[],
    runtime: Runtime,
    hooks: RunHooks,
  ): Promise<number>;
}

export interface RunState {
  commandId: string;
  docsBaseUrl: string | undefined;
  prefix: readonly string[];
  format: Format;
  logLevel: LogLevel;
  yes: boolean;
  interactive: boolean;
  colorEnabled: boolean;
  resolved: boolean;
  settledExitCode: number | undefined;
  usageErrorText: string | undefined;
  internalErrorText: string | undefined;
  stricliStderr: string;
  /** The stdin iterator a prompt opened, closed when the run settles so
   *  a real process's stdin never keeps the event loop alive. */
  stdinIterator: AsyncIterator<Uint8Array> | undefined;
}

export interface Invocation {
  readonly runtime: Runtime;
  readonly hooks: RunHooks;
  readonly now: () => Date;
  readonly state: RunState;
  /** The engine-owned abort signal behind ctx.signal, fed by the
   *  runtime's signal subscription. */
  readonly signal: AbortSignal;
}

export function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return (newline === -1 ? text : text.slice(0, newline)).trim();
}
