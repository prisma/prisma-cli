const REDACTED = "…";

const URL_USERINFO = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@]+@/g;

const ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g;

const SECRET_NAME = /TOKEN|KEY|SECRET|PASSWORD/i;

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
      SECRET_NAME.test(name) ? `${name}=${REDACTED}` : assignment,
    );
}
