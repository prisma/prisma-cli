/** A show's data lines: one `key<TAB>value` line per field that has a
 *  value. A field whose value is absent (an empty string) is left out. */
export function fieldLines(
  rows: readonly { readonly label: string; readonly value: string }[],
): string[] {
  return rows
    .filter((row) => row.value !== "")
    .map((row) => `${row.label}\t${row.value}`);
}
