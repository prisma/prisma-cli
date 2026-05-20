export interface VersionResult {
  cli: {
    name: string;
    version: string;
  };
  node: {
    version: string;
  };
  os: {
    platform: string;
    arch: string;
  };
  invocation: VersionInvocation;
}

export type VersionInvocation = "bunx" | "npx" | "global" | "dev" | "unknown";

export interface VersionFlagResult {
  version: string;
}
