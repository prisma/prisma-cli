/** Serialization the compute config was written in. */
export type InitConfigFormat = "typescript" | "json";

export interface InitSettingRow {
  key: string;
  value: string;
  source: string;
}

export type InitLinkStatus =
  | "linked"
  | "already-linked"
  | "skipped"
  | "declined"
  | "failed";

export interface InitLinkState {
  status: InitLinkStatus;
  project: {
    id: string;
    name: string;
  } | null;
}

export type InitTypesStatus =
  | "installed"
  | "already-installed"
  | "skipped"
  | "declined"
  | "failed";

export interface InitTypesState {
  status: InitTypesStatus;
  package: string;
  /** Human-runnable install command for hints when not installed. */
  installCommand: string | null;
}

export interface InitResult {
  configPath: string;
  format: InitConfigFormat;
  /** True when init converted an existing prisma.compute.json to TypeScript. */
  converted: boolean;
  directory: string;
  /**
   * App identity pinned by the written config. Null when a conversion
   * transported a config that does not pin a single fully-resolved app.
   */
  app: {
    name: string;
    framework: string;
    httpPort: number;
    entry?: string;
    region?: string;
  } | null;
  settings: InitSettingRow[];
  types: InitTypesState;
  link: InitLinkState;
}
