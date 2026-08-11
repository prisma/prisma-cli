export declare function resolveDevVersion(options: {
  baseVersion?: string | number | null;
  runNumber?: string | number | null;
  runAttempt?: string | number | null;
}): string;

export declare function resolveNextBetaVersion(options: {
  baseVersion?: string | number | null;
  latest?: string | null;
}): string;

export declare function resolvePackageReleaseBaseVersion(
  packageDir: string,
): string;
