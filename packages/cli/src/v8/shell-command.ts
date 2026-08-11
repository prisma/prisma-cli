/** Renders a command as a line a user can paste into a shell, quoting
 *  any word that needs it. */
export function formatShellCommand(command: readonly string[]): string {
  return command.map(formatShellCommandWord).join(" ");
}

function formatShellCommandWord(value: string): string {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}
