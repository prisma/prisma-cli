export declare const CLI_RELEASE_BASE_VERSION: string;

export declare function resolveDevVersion(options: {
  runNumber?: string | number | null;
  runAttempt?: string | number | null;
}): string;

export declare function resolvePrVersion(options: {
  prNumber?: string | number | null;
  sha?: string | null;
}): string;

export declare function resolveNextBetaVersion(latest?: string | null): string;
