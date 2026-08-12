export function envVarNames(
  envVars: Record<string, string | null> | undefined,
): string[] {
  if (!envVars) {
    return [];
  }

  return Object.entries(envVars)
    .filter(([, value]) => value !== null)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}
