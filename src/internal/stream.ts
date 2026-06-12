import { abortError } from "./signal";

export async function* streamChunks(
  stream: ReadableStream<string>,
  signal: AbortSignal,
): AsyncIterable<string> {
  if (signal.aborted) {
    throw abortError(signal.reason);
  }
  const reader = stream.getReader();
  const onAbort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) {
        throw abortError(signal.reason);
      }
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    // The consumer may exit early (break/throw): releasing the lock alone
    // would leave the source producing into an abandoned stream. Cancel is a
    // no-op on a drained or already-cancelled stream.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
