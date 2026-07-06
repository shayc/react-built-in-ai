export function abortError(reason?: unknown): DOMException {
  return reason instanceof DOMException && reason.name === "AbortError"
    ? reason
    : new DOMException(
        typeof reason === "string" ? reason : "Aborted",
        "AbortError",
      );
}

export function mergeSignals(
  ...signals: readonly (AbortSignal | undefined)[]
): AbortSignal {
  const present = signals.filter((s) => s instanceof AbortSignal);
  // A single signal passes through untouched, preserving its abort reason
  // verbatim; zero signals yields AbortSignal.any([]), which never aborts.
  return present.length === 1 ? present[0] : AbortSignal.any(present);
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

  promise.then(
    (value) => {
      cleanup.abort();
      resolve(value);
    },
    (error: unknown) => {
      cleanup.abort();
      // The promise's own rejection is a genuine failure, not a cancellation:
      // pass it through verbatim (mirroring the resolve path above), so a
      // thrown non-Error isn't misclassified as an AbortError. Only the abort
      // paths route through toError, where coercing to AbortError is correct.
      reject(error);
    },
  );

  return result;
}

// Coerces an abort *reason* to an Error, defaulting a non-Error reason to an
// AbortError — the right classification for a cancellation. Only called with
// `signal.reason`; a promise's own rejection passes through unwrapped.
function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : abortError(reason);
}
