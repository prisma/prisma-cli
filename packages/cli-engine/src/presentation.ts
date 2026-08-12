import type { Diagnostic, NextAction } from "./protocol";

export type Format = "human" | "json";

/**
 * What a command concluded, stated at the return site. `exitCode` is
 * required at every return site iff the command documents exit codes,
 * and forbidden otherwise. `diagnostics` may be omitted at the call
 * site; the presented result always carries an array.
 */
export type Outcome<T, TCode extends number = never> = [TCode] extends [never]
  ? {
      readonly data: T;
      readonly diagnostics?: readonly Diagnostic[];
    }
  : {
      readonly data: T;
      readonly exitCode: TCode | 0;
      readonly diagnostics?: readonly Diagnostic[];
    };

export const PRESENTED: unique symbol = Symbol.for(
  "prisma.cli-engine.presented",
);

/**
 * What a completed command's handler returns inside `ok(...)`: the
 * outcome plus the presentation the active format already materialized.
 * Built exclusively by ctx.present — the brand makes hand-construction
 * a type error. Human rendering writes the blocks, next-action lines,
 * and diagnostics to stderr and the `stdout` lines to stdout — human
 * mode is pipe-clean (operator ruling, 2026-08-09).
 */
export interface PresentedResult<T> {
  readonly [PRESENTED]: true;
  readonly data: T;
  /** 0 unless the outcome selected a documented code. */
  readonly exitCode: number;
  /** Never undefined; empty when the outcome recorded no findings. */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * Only the active format's presentation is materialized; the other
   * format's fields are normalized to empty. In human mode `json` is
   * undefined because the json presentation was never invoked.
   */
  readonly presentation: {
    readonly human: readonly Block[];
    readonly stdout: readonly string[];
    readonly json: unknown;
    readonly next: readonly NextAction[];
  };
}

/**
 * The per-format presentation functions a handler supplies to
 * ctx.present. Every one is required: a command states each output
 * surface it publishes rather than inheriting one by omission. Only the
 * active format's functions are invoked, at the return site. `human`
 * composes engine primitives, rendered to stderr; `stdout` is the
 * machine-consumable data lines — what a pipe receives, the human
 * mode's only stdout writes; `json` is the `--json` envelope's
 * `result`; `next` is the suggested follow-up actions.
 */
export interface Presentations {
  readonly human: (ui: Ui) => readonly Block[];
  readonly stdout: () => readonly string[];
  readonly json: () => unknown;
  readonly next: () => readonly NextAction[];
}

/**
 * What happened: it selects the glyph (✔ ✘ ⚠ ℹ) and carries a default
 * Tone of the same name. Separate from Tone because a failure can be
 * painted in a colour that is not `error` — a tree node in its branch
 * lane's hue, say — and a colour can be chosen where nothing happened.
 */
export type Status = "ok" | "error" | "warn" | "info";

/**
 * What colour to paint, and nothing else. Semantic names and indexed
 * colours in one union: a command asks for meaning where it has one and
 * for a distinguishable colour where it does not. The indexed colours
 * are for telling adjacent things apart — one per branch lane in a
 * graph, say — and deliberately exclude red so no series member reads
 * as an error.
 */
export type Tone =
  | "ok"
  | "warn"
  | "error"
  | "info"
  | "heading"
  | "identifier"
  | "ref"
  | "placeholder"
  | "link"
  | "emphasis"
  | "muted"
  | "structure"
  | "highlight"
  | "color-1"
  | "color-2"
  | "color-3"
  | "color-4"
  | "color-5"
  | "color-6";

/**
 * A run of text and the meaning of its colour. A handler never emits
 * escape sequences: the engine measures width from `text`, so colour
 * cannot break alignment, and the same spans can be re-themed or
 * stripped without re-rendering.
 */
export interface Span {
  readonly text: string;
  readonly tone?: Tone;
}

/** Display text anywhere a block or Ui takes it. A bare string is untoned. */
export type Text = string | readonly Span[];

/**
 * Deliberately small; grows by the same evidence rule as events.
 * Recorded findings are NOT a Block — they are the outcome's
 * diagnostics; the engine renders them and carries them into the
 * envelope, so the two surfaces cannot diverge.
 */
export type Block =
  | {
      readonly kind: "summary";
      readonly status: Status;
      /** Overrides the colour the status implies. Never the glyph. */
      readonly tone?: Tone;
      readonly text: Text;
    }
  | {
      /** A key/value card: the engine pads the keys so every value
       *  starts in the same column. */
      readonly kind: "fields";
      readonly rows: ReadonlyArray<{
        readonly label: Text;
        readonly value: Text;
        readonly sensitive?: boolean;
      }>;
      /** Draws the dim `│` rail down the left of the card. A command
       *  knows whether it is drawing a header card or a plain one, so
       *  this is per block rather than a global setting. */
      readonly rail?: boolean;
    }
  | {
      /** The engine sizes every column to its widest cell. */
      readonly kind: "table";
      readonly columns: readonly Text[];
      readonly rows: ReadonlyArray<readonly Text[]>;
    }
  | { readonly kind: "list"; readonly items: readonly Text[] }
  | { readonly kind: "tree"; readonly roots: readonly TreeNode[] }
  | {
      /**
       * Lines of spans, rendered verbatim — no layout, no reflow, no
       * truncation. For output whose two-dimensional structure the
       * engine cannot derive, such as a migration graph's lane gutter,
       * where the same hue has to reach the gutter cell, the node glyph
       * and the label alike.
       */
      readonly kind: "drawing";
      readonly lines: readonly Text[];
    };

export interface TreeNode {
  readonly label: Text;
  /** Renders its glyph before the label. */
  readonly status?: Status;
  /** Colours the glyph and the label; defaults to the status. */
  readonly tone?: Tone;
  readonly children?: readonly TreeNode[];
}

/** Styling helpers usable inside block text; no direct writing. */
export interface Ui {
  /**
   * How much room the command has: stderr's terminal width, or
   * Number.POSITIVE_INFINITY when stderr is not a terminal. Only the
   * command knows what to sacrifice, so the engine hands over the number
   * and prints an overrun unmodified.
   */
  readonly width: number;
  readonly emphasize: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly code: (text: string) => string;
  readonly tone: (tone: Tone, text: string) => string;
}
