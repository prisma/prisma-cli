/** Minimal structural stream types; no NodeJS.* in the public surface. */
export interface OutputStream {
  write(text: string): void;
}

/**
 * Byte-oriented, so server commands can implement byte-counted
 * protocols (lsp's Content-Length framing). setRawMode is present
 * where the platform supports keypress input.
 */
export interface InputStream extends AsyncIterable<Uint8Array> {
  readonly setRawMode?: (enabled: boolean) => void;
}
