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

export interface InitResult {
  configPath: string;
  directory: string;
  app: {
    name: string;
    framework: string;
    httpPort: number;
    entry?: string;
    region?: string;
  };
  settings: InitSettingRow[];
  link: InitLinkState;
}
