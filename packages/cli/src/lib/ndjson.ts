/**
 * Reads a newline-delimited JSON body line by line.
 *
 * Shared by every command that reads an NDJSON log page, so the stream
 * handling below is written and tested once. The two subtleties are the
 * reason: a chunk boundary can fall inside a line, and a body can end
 * without a trailing newline, so the last record arrives only if the
 * leftover buffer is flushed at `done`.
 */
export async function forEachNdjsonRecord<T>(
  body: ReadableStream<Uint8Array>,
  onRecord: (record: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // An abort, a malformed line, or a throwing onRecord all leave the
  // loop without reaching `done`. Cancelling closes the HTTP body
  // instead of holding the socket open until garbage collection, which
  // a long `--follow` run makes observable.
  try {
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: a stream must be read sequentially, chunk by chunk.
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          onRecord(JSON.parse(line) as T);
        }
        newlineIndex = buffer.indexOf("\n");
      }

      if (done) {
        const tail = buffer.trim();
        if (tail) {
          onRecord(JSON.parse(tail) as T);
        }
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
