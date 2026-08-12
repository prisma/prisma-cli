/**
 * The context the surviving legacy operation layer takes. The commander
 * shell that built it is gone, and the operations read only these three
 * runtime fields; v8 command handlers supply them
 * (`src/v8/project/context.ts`).
 */
export interface CliRuntime {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}

export interface CommandContext {
  runtime: CliRuntime;
}
