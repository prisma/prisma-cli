const REDACTED = "…";

/** The userinfo run stops only at the path, so the LAST `@` before it
 *  ends the userinfo: a password containing `@` goes whole. Backtracking
 *  cannot cross a `/`, so a URL whose path contains `@` and whose
 *  userinfo is absent stays as it is. */
const URL_USERINFO = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/]+@/g;

const ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g;

const SECRET_WORDS = new Set(["TOKEN", "KEY", "SECRET", "PASSWORD"]);

/** Underscores and camelCase humps: `MY_API_TOKEN` and `_authToken`
 *  name a secret, `monkey` and `tokenizer` do not. */
const NAME_WORDS = /_+|(?<=[a-z0-9])(?=[A-Z])/;

function namesSecret(name: string): boolean {
  return name
    .split(NAME_WORDS)
    .some((word) => SECRET_WORDS.has(word.toUpperCase()));
}

/**
 * Removes the two shapes a package manager's output leaks credentials
 * in: the userinfo of a URL, and the value of a variable whose name
 * says it holds a secret. Everything else survives verbatim, so a
 * caller matching an error code out of stderr still finds it.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(ASSIGNMENT, (assignment, name: string) =>
      namesSecret(name) ? `${name}=${REDACTED}` : assignment,
    );
}
