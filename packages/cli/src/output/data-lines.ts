/**
 * The stdout data lines of a command whose only result is that it
 * succeeded. The reason names why the command has no data, so every
 * command without data lines says so where it is defined.
 */
export function noDataLines(_reason: string): () => readonly string[] {
  return () => [];
}

/** A show's data lines when no single value identifies the resource:
 *  one `key<TAB>value` line per field. */
export function fieldLines(
  rows: readonly { readonly label: string; readonly value: string }[],
): string[] {
  return rows.map((row) => `${row.label}\t${row.value}`);
}
