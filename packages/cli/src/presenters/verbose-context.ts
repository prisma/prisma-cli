export function stripVerboseContext<T extends { verboseContext?: unknown }>(
  result: T,
): Omit<T, "verboseContext"> {
  const { verboseContext: _verboseContext, ...serialized } = result;
  return serialized;
}
