import type { Readable, Writable } from "node:stream";
import { confirm, isCancel, select, text } from "@clack/prompts";

import { usageError } from "./errors";

export interface SelectOption<T> {
  label: string;
  value: T;
}

export async function selectPrompt<T>(options: {
  input: Readable;
  output: Writable;
  message: string;
  choices: SelectOption<T>[];
}): Promise<T> {
  const promptOptions = options.choices.map((choice) => ({
    label: choice.label,
    value: choice.value,
  })) as Parameters<typeof select<T>>[0]["options"];

  const response = await select({
    input: options.input,
    output: options.output,
    message: options.message,
    options: promptOptions,
  });

  if (isCancel(response)) {
    throw usageError(
      "Interactive prompt canceled",
      "The command was canceled before a selection was made.",
      "Re-run the command and choose an option to continue.",
    );
  }

  return response;
}

export async function textPrompt(options: {
  input: Readable;
  output: Writable;
  message: string;
  placeholder?: string;
  validate?: (value: string | undefined) => string | undefined;
}): Promise<string> {
  const response = await text({
    input: options.input,
    output: options.output,
    message: options.message,
    placeholder: options.placeholder,
    validate: options.validate,
  });

  if (isCancel(response)) {
    throw usageError(
      "Interactive prompt canceled",
      "The command was canceled before a value was entered.",
      "Re-run the command and provide a value to continue.",
    );
  }

  return response;
}

export async function confirmPrompt(options: {
  input: Readable;
  output: Writable;
  message: string;
  initialValue?: boolean;
}): Promise<boolean> {
  const response = await confirm({
    input: options.input,
    output: options.output,
    message: options.message,
    initialValue: options.initialValue ?? false,
  });

  if (isCancel(response)) {
    throw usageError(
      "Interactive prompt canceled",
      "The command was canceled before a confirmation was made.",
      "Re-run the command and choose an option to continue.",
    );
  }

  return response;
}

export function disposePromptState(_input: Readable): void {
  // @clack/prompts manages its own input listeners for each prompt invocation.
}
