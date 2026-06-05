export interface LocalGitState {
  ref: string | null;
  sha: string | null;
  dirty: boolean | null;
}

export interface CommandDiagnostics {
  cwd: string;
  stateFilePath: string;
  git: LocalGitState | null;
  durationMs?: number;
}
