import type { Writable } from "node:stream";

import type { NextAction } from "../next-actions";

export interface CommandSuccess<T> {
  command: string;
  result: T;
  warnings: string[];
  nextSteps: string[];
  nextActions?: NextAction[];
}

export interface CliOutput {
  stdout: Writable;
  stderr: Writable;
}
