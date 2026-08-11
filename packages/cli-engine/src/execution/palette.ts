/**
 * Tones into bytes, and text into a display width. Basic 16-colour SGR
 * only — no 256-colour, no truecolor, and therefore no colour-depth
 * detection to own.
 */
import { createColors } from "colorette";
import stringWidth from "string-width";
import type { Text, Tone } from "../presentation";

/** Paints one run of text in a tone; the identity function when colour
 *  is off, so a renderer has one code path and no `if (colour)` branch. */
export type Paint = (tone: Tone, text: string) => string;

type ColorVerb = keyof ReturnType<typeof createColors>;

/**
 * Every rendering is taken from a shipping implementation rather than
 * chosen fresh: the platform shell's semantic colours
 * (`packages/cli/src/shell/ui.ts`) and the ORM CLI's formatters. The
 * indexed colours are the ORM's lane rotation, in order, which excludes
 * red so a lane cannot be mistaken for an error.
 *
 * `heading` and `identifier` both render cyan because both shipping
 * CLIs use cyan for both. They stay separately named so a later
 * re-theme can separate them without touching a single command.
 */
const TONE_VERB: Readonly<Record<Tone, ColorVerb>> = {
  ok: "greenBright",
  warn: "yellow",
  error: "redBright",
  info: "blue",
  heading: "cyan",
  identifier: "cyan",
  ref: "green",
  placeholder: "dim",
  link: "blue",
  emphasis: "bold",
  muted: "dim",
  structure: "dim",
  highlight: "greenBright",
  "color-1": "white",
  "color-2": "cyan",
  "color-3": "yellow",
  "color-4": "blueBright",
  "color-5": "magenta",
  "color-6": "green",
};

const COLORED = createColors({ useColor: true });
const PLAIN = createColors({ useColor: false });

export function makePaint(colorEnabled: boolean): Paint {
  const colors = colorEnabled ? COLORED : PLAIN;
  return (tone, text) => colors[TONE_VERB[tone]](text);
}

export function renderText(text: Text, paint: Paint): string {
  if (typeof text === "string") {
    return text;
  }
  let rendered = "";
  for (const span of text) {
    rendered +=
      span.tone === undefined ? span.text : paint(span.tone, span.text);
  }
  return rendered;
}

/**
 * The display width of what the reader sees, measured on the text the
 * spans carry rather than on the rendered bytes: colour cannot change a
 * column's width, and a CJK name is two cells wide, not one.
 */
export function textWidth(text: Text): number {
  return stringWidth(plainText(text));
}

/** The text a reader sees, with every tone dropped. */
export function plainText(text: Text): string {
  if (typeof text === "string") {
    return text;
  }
  let plain = "";
  for (const span of text) {
    plain += span.text;
  }
  return plain;
}
