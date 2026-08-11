const REDACTED = "…";

/** A candidate runs from a scheme to the end of the authority, which is
 *  the only part of a URL userinfo can be in. Delimiting it is all this
 *  does; `URL` below decides whether the candidate is a URL at all. What
 *  follows the authority is never matched, so a path holding an `@`, and
 *  the punctuation a URL ending a sentence carries, are untouched. */
const URL_AUTHORITY = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/?#<>]+/g;

const AUTHORITY_MARK = "://";

/** `new URL` throws for everything that is not a URL, which is how a
 *  candidate is rejected. */
function asUrl(candidate: string): URL | undefined {
  try {
    return new URL(candidate);
  } catch {
    return undefined;
  }
}

/** `URL` reports whether there is userinfo at all, and the `@` that ends
 *  it is the last one in the authority. Only that span of the original
 *  text is replaced: serialising the parsed URL back out would return a
 *  normalised one — default port dropped, path resolved, password
 *  percent-encoded — and the surrounding output has to survive verbatim. */
function redactUserinfo(candidate: string): string {
  const url = asUrl(candidate);
  if (url === undefined || (url.username === "" && url.password === "")) {
    return candidate;
  }
  const start = candidate.indexOf(AUTHORITY_MARK) + AUTHORITY_MARK.length;
  const end = candidate.lastIndexOf("@");
  return `${candidate.slice(0, start)}${REDACTED}${candidate.slice(end)}`;
}

const VALUE = String.raw`"[^"]*"|'[^']*'|\S+`;

const ASSIGNMENT = new RegExp(
  String.raw`\b([A-Za-z_][A-Za-z0-9_]*)=(${VALUE})`,
  "g",
);

/** A header's value runs to the end of its line, because an auth scheme
 *  and its credential are one value: `Authorization: Bearer eyJ…`. */
const HEADER = /\b([A-Za-z][A-Za-z0-9_-]*):[ \t]+[^\n]+/g;

/** A flag's value is the word after it. A word starting with a dash is
 *  the next flag rather than this one's value. */
const FLAG = new RegExp(
  String.raw`(--?[A-Za-z][A-Za-z0-9_-]*)[ \t]+(?!-)(?:${VALUE})`,
  "g",
);

const SECRET_WORDS = new Set([
  "TOKEN",
  "KEY",
  "SECRET",
  "PASSWORD",
  "AUTHORIZATION",
]);

/** Underscores, hyphens and camelCase humps: `MY_API_TOKEN`,
 *  `--auth-token` and `_authToken` name a secret; `monkey`,
 *  `--keyring` and `tokenizer` do not. */
const NAME_WORDS = /[_-]+|(?<=[a-z0-9])(?=[A-Z])/;

function namesSecret(name: string): boolean {
  return name
    .split(NAME_WORDS)
    .some((word) => SECRET_WORDS.has(word.toUpperCase()));
}

/**
 * Removes the shapes a package manager's output leaks credentials in:
 * the userinfo of a URL, and the value carried by a name that says it
 * holds a secret — after an `=`, after a header's colon, or after a
 * flag. Everything else survives verbatim, so a caller matching an
 * error code out of stderr still finds it.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(URL_AUTHORITY, redactUserinfo)
    .replace(ASSIGNMENT, (assignment, name: string) =>
      namesSecret(name) ? `${name}=${REDACTED}` : assignment,
    )
    .replace(HEADER, (header, name: string) =>
      namesSecret(name) ? `${name}: ${REDACTED}` : header,
    )
    .replace(FLAG, (flag, name: string) =>
      namesSecret(name) ? `${name} ${REDACTED}` : flag,
    );
}
