import type { Writable } from "node:stream";

/** What an env-file controller returns: the result plus the findings it
 *  collected along the way, which the command turns into diagnostics. */
export interface CommandSuccess<T> {
  command: string;
  result: T;
  warnings: string[];
}

export interface CliOutput {
  stdout: Writable;
  stderr: Writable;
}
