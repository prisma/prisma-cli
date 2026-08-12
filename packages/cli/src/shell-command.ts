/** A word a shell needs no quoting for. */
const SHELL_SAFE_WORD = /^[A-Za-z0-9_./:@=-]+$/;
const SINGLE_QUOTE = /'/g;

/** Renders a command as a line a user can paste into a shell, quoting
 *  any word that needs it. */
export function formatShellCommand(command: readonly string[]): string {
  return command.map(formatShellCommandWord).join(" ");
}

function formatShellCommandWord(value: string): string {
  return SHELL_SAFE_WORD.test(value)
    ? value
    : `'${value.replace(SINGLE_QUOTE, "'\\''")}'`;
}
