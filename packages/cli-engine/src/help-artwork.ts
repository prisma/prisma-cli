export type HelpArtworkLine =
  | string
  | readonly {
      readonly text: string;
      readonly rgb?: readonly [number, number, number];
    }[];

export function renderArtworkLine(
  line: HelpArtworkLine,
  colorEnabled: boolean,
): string {
  if (typeof line === "string") return line;
  return line
    .map(({ text, rgb }) =>
      colorEnabled && rgb !== undefined
        ? `\u001b[38;2;${rgb.join(";")}m${text}\u001b[39m`
        : text,
    )
    .join("");
}

/** Paint each RGB band in first-appearance order, preserving every cell. */
export function revealArtwork(
  lines: readonly HelpArtworkLine[] | undefined,
  progress: number,
): readonly HelpArtworkLine[] | undefined {
  if (lines === undefined || progress >= 1) return lines;
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (typeof line === "string") continue;
    for (const { text, rgb } of line) {
      if (rgb === undefined) continue;
      const key = rgb.join(";");
      totals.set(key, (totals.get(key) ?? 0) + text.replace(/ /g, "").length);
    }
  }
  const budgets = new Map(
    [...totals].map(([key, total], index) => [
      key,
      Math.floor(
        total * Math.max(0, Math.min(1, progress * totals.size - index)),
      ),
    ]),
  );
  return lines.map((line) =>
    typeof line === "string"
      ? line
      : line.map((span) => {
          if (span.rgb === undefined) return span;
          const key = span.rgb.join(";");
          const text = span.text.replace(/[^ ]/g, (character) => {
            const remaining = budgets.get(key) ?? 0;
            budgets.set(key, remaining - 1);
            return remaining > 0 ? character : " ";
          });
          return { ...span, text };
        }),
  );
}
