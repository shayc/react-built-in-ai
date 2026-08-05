export function abortError(reason?: unknown): DOMException {
  return reason instanceof DOMException && reason.name === "AbortError"
    ? reason
    : new DOMException(
        typeof reason === "string" ? reason : "Aborted",
        "AbortError",
      );
}

export function mergeSignals(
  primary: AbortSignal,
  secondary?: AbortSignal,
): AbortSignal {
  return secondary === undefined
    ? primary
    : AbortSignal.any([primary, secondary]);
}

export function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(toError(signal.reason));
  }

  const { promise: result, resolve, reject } = Promise.withResolvers<T>();
  // Aborting `cleanup` detaches the abort listener once the race settles, so
  // a long-lived signal doesn't accumulate one listener per call.
  const cleanup = new AbortController();

  signal.addEventListener("abort", () => reject(toError(signal.reason)), {
    signal: cleanup.signal,
  });

  // The promise's own rejection is a genuine failure, not a cancellation, so
  // forward both outcomes verbatim. Only the abort paths route through toError.
  promise.then(resolve, reject);

  return result.finally(() => cleanup.abort());
}

// Coerces an abort *reason* to an Error, defaulting a non-Error reason to an
// AbortError — the right classification for a cancellation. Only called with
// `signal.reason`; a promise's own rejection passes through unwrapped.
function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : abortError(reason);
}
