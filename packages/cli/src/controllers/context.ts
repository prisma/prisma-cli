/**
 * The context the project and env controllers take. The commander
 * shell that once built it is gone; the controllers read only these
 * three runtime fields, and the command handlers supply them
 * (`src/commands/project/context.ts`).
 */
export interface CliRuntime {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}

export interface CommandContext {
  runtime: CliRuntime;
}
