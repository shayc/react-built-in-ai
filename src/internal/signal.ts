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
      reject(toError(error));
    },
  );

  return result;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : abortError(reason);
}
