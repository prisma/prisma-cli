// biome-ignore-all lint/performance/useTopLevelRegex: Existing shell quoting regexes are kept inline for readability.
export function formatCommandArgument(value: string): string {
  return /^[A-Za-z0-9._/-]+$/.test(value) && !value.startsWith("-")
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}
