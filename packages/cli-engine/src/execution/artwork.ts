import { styleText } from "node:util";
import { resolveIsCI } from "../ci";
import {
  type HelpArtworkLine,
  renderArtworkLine,
  revealArtwork,
} from "../help-artwork";
import type { OutputStream, Runtime } from "../runtime";
import type { Invocation } from "./engine";
import { textWidth } from "./palette";

export async function runCommandArtwork(
  artwork: readonly HelpArtworkLine[] | undefined,
  { runtime, state, signal, delay }: Invocation,
): Promise<void> {
  if (signal.aborted) throw signal.reason;
  const out = runtime.stderr;
  if (
    state.format !== "human" ||
    state.logLevel === "error" ||
    !runtime.isTty.stderr
  )
    return;
  await writeArtworkFrames({
    out,
    animate:
      state.interactive &&
      canAnimateArtwork(runtime, state.argv, state.colorEnabled),
    delay,
    signal,
    render: (progress) => {
      const lines: string[] = [];
      const rows = addArtwork(
        lines,
        artwork,
        out.columns,
        state.colorEnabled,
        progress,
      );
      return { text: rows === 0 ? "" : `${lines.join("\n")}\n`, rows };
    },
  });
  if (signal.aborted) throw signal.reason;
}

export function addArtwork(
  lines: string[],
  source: readonly HelpArtworkLine[] | undefined,
  columns: number | undefined,
  colorEnabled: boolean,
  progress: number,
): number {
  const artwork = revealArtwork(source, progress)?.map((line) =>
    colorEnabled
      ? styleText(
          "reset",
          styleText("bold", renderArtworkLine(line, true), {
            validateStream: false,
          }),
          { validateStream: false },
        )
      : renderArtworkLine(line, false),
  );
  if (!artwork?.length || columns === undefined || !Number.isFinite(columns)) {
    return 0;
  }
  const start = 2;
  const width = Math.max(...artwork.map(textWidth));
  const left = columns - width - 2;
  if (
    artwork.length > lines.length - start ||
    lines
      .slice(start, start + artwork.length)
      .some((line) => textWidth(line) + 4 > left)
  ) {
    if (columns >= width + 4) {
      lines.unshift(...artwork.map((row) => `  ${row}`), "");
      return artwork.length + 1;
    }
    return 0;
  }
  for (const [index, row] of artwork.entries()) {
    const line = lines[start + index];
    lines[start + index] = `${line}${" ".repeat(left - textWidth(line))}${row}`;
  }
  return start + artwork.length;
}

export async function writeArtworkFrames({
  out,
  render,
  animate,
  delay,
  signal,
}: {
  out: OutputStream;
  render: (progress: number) => { text: string; rows: number };
  animate: boolean;
  delay: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
}): Promise<void> {
  const columns = out.columns;
  const rows = out.rows;
  const resized = () => out.columns !== columns || out.rows !== rows;
  const final = render(1);
  if (!animate || final.rows === 0 || final.rows + 1 >= (out.rows ?? 24)) {
    out.write(final.text);
    return;
  }
  const frame = (progress: number): string =>
    `${render(progress).text.split("\n").slice(0, final.rows).join("\n")}\n`;
  try {
    out.write(`\u001b[?25l${frame(0)}`);
    for (let step = 1; step <= 30; step++) {
      // biome-ignore lint/performance/noAwaitInLoops: Frames must be paced sequentially.
      await delay(20, signal);
      if (signal.aborted || resized()) break;
      out.write(`\u001b[${final.rows}A\r${frame(step / 30)}`);
    }
  } finally {
    try {
      out.write(
        resized()
          ? `\r\n${render(1).text}`
          : `\u001b[${final.rows}A\r${final.text}`,
      );
    } finally {
      out.write("\u001b[?25h");
    }
  }
}

export function canAnimateArtwork(
  runtime: Runtime,
  argv: readonly string[],
  color: boolean,
): boolean {
  const terminator = argv.indexOf("--");
  const flags = terminator === -1 ? argv : argv.slice(0, terminator);
  return (
    color &&
    !resolveIsCI(runtime) &&
    runtime.env.TERM !== "dumb" &&
    runtime.env.NO_COLOR === undefined &&
    runtime.env.PRISMA_REDUCED_MOTION !== "1" &&
    !flags.some((flag) => ["--no-interactive", "--quiet", "-q"].includes(flag))
  );
}
