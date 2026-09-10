import { styleText } from "node:util";

export type HelpArtworkLine =
  | string
  | readonly {
      readonly text: string;
      readonly color?: "cyan" | "redBright" | "yellow";
    }[];

export function renderArtworkLine(
  line: HelpArtworkLine,
  colorEnabled: boolean,
): string {
  if (typeof line === "string") return line;
  return line
    .map(({ text, color }) =>
      colorEnabled && color !== undefined
        ? styleText(color, text, { validateStream: false })
        : text,
    )
    .join("");
}

/** Paint each color band in first-appearance order, preserving every cell. */
export function revealArtwork(
  lines: readonly HelpArtworkLine[] | undefined,
  progress: number,
): readonly HelpArtworkLine[] | undefined {
  if (lines === undefined || progress >= 1) return lines;
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (typeof line === "string") continue;
    for (const { text, color } of line) {
      if (color === undefined) continue;
      const key = color;
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
          if (span.color === undefined) return span;
          const key = span.color;
          const text = span.text.replace(/[^ ]/g, (character) => {
            const remaining = budgets.get(key) ?? 0;
            budgets.set(key, remaining - 1);
            return remaining > 0 ? character : " ";
          });
          return { ...span, text };
        }),
  );
}
