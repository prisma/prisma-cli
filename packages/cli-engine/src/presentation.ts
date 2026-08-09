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
  readonly presentation: {
    readonly human?: readonly Block[];
    readonly stdout?: readonly string[];
    readonly json?: unknown;
    readonly next?: readonly NextAction[];
  };
}

/**
 * The per-format presentation functions a handler supplies to
 * ctx.present. Only the active format's functions are invoked, at the
 * return site. `human` composes engine primitives, rendered to stderr;
 * `stdout` is the machine-consumable data lines — what a pipe
 * receives, the human mode's only stdout writes.
 */
export interface Presentations {
  readonly human: (ui: Ui) => readonly Block[];
  readonly stdout?: () => readonly string[];
  readonly json?: () => unknown;
  readonly next?: () => readonly NextAction[];
}

/**
 * Deliberately small; grows by the same evidence rule as events.
 * Recorded findings are NOT a Block — they are the outcome's
 * diagnostics; the engine renders them and carries them into the
 * envelope, so the two surfaces cannot diverge.
 */
export type Block =
  | {
      readonly kind: "summary";
      readonly tone: "ok" | "error" | "warn" | "info";
      readonly text: string;
    }
  | {
      readonly kind: "fields";
      readonly rows: ReadonlyArray<{
        label: string;
        value: string;
        sensitive?: boolean;
      }>;
    }
  | {
      readonly kind: "table";
      readonly columns: readonly string[];
      readonly rows: ReadonlyArray<readonly string[]>;
    }
  | { readonly kind: "list"; readonly items: readonly string[] }
  | { readonly kind: "tree"; readonly roots: readonly TreeNode[] };

export interface TreeNode {
  readonly label: string;
  readonly children?: readonly TreeNode[];
}

/** Styling helpers usable inside block text; no direct writing. */
export interface Ui {
  readonly emphasize: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly code: (text: string) => string;
}
