import {
  type Block,
  PRESENTED,
  type PresentedResult,
  type Text,
} from "../presentation";
import type { Diagnostic, NextAction } from "../protocol";
import { substituteBinName } from "./stricli-adapter";

function inText(text: Text, cliName: string): Text {
  return typeof text === "string"
    ? substituteBinName(text, cliName)
    : text.map((span) => ({
        ...span,
        text: substituteBinName(span.text, cliName),
      }));
}

function inBlock(block: Block, cliName: string): Block {
  switch (block.kind) {
    case "summary":
      return { ...block, text: inText(block.text, cliName) };
    case "list":
      return {
        ...block,
        items: block.items.map((item) => inText(item, cliName)),
      };
    case "fields":
    case "table":
    case "tree":
    case "drawing":
      return block;
  }
}

export function nextActionsWithBinName(
  actions: readonly NextAction[],
  cliName: string,
): readonly NextAction[] {
  return actions.map((action) => ({
    ...action,
    label: substituteBinName(action.label, cliName),
    ...(action.reason === undefined
      ? {}
      : { reason: substituteBinName(action.reason, cliName) }),
    ...(action.command === undefined
      ? {}
      : { command: substituteBinName(action.command, cliName) }),
    ...(action.commands === undefined
      ? {}
      : {
          commands: action.commands.map((command) =>
            substituteBinName(command, cliName),
          ),
        }),
  }));
}

export function diagnosticWithBinName(
  diagnostic: Diagnostic,
  cliName: string,
): Diagnostic {
  return {
    ...diagnostic,
    summary: substituteBinName(diagnostic.summary, cliName),
    ...(diagnostic.why === undefined
      ? {}
      : { why: substituteBinName(diagnostic.why, cliName) }),
    nextActions: nextActionsWithBinName(diagnostic.nextActions, cliName),
  };
}

/** Only summary and list blocks are rewritten. Every other block, the
 *  data, the json result and the stdout lines can hold user data and
 *  pass through unchanged. */
export function presentedWithBinName<T>(
  presented: PresentedResult<T>,
  cliName: string,
): PresentedResult<T> {
  return {
    ...presented,
    [PRESENTED]: true,
    diagnostics: presented.diagnostics.map((diagnostic) =>
      diagnosticWithBinName(diagnostic, cliName),
    ),
    presentation: {
      ...presented.presentation,
      human: presented.presentation.human.map((block) =>
        inBlock(block, cliName),
      ),
      next: nextActionsWithBinName(presented.presentation.next, cliName),
    },
  };
}
