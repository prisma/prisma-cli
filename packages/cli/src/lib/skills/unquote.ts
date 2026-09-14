const QUOTED = /^(["'])(.*)\1$/;

/** Strips one layer of matching single or double quotes. */
export function unquote(value: string): string {
  const quoted = QUOTED.exec(value);
  return quoted?.[2] ?? value;
}
