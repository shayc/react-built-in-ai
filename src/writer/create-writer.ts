import { provisionStandalone } from "../internal/lifecycle/provision";
import type { WriterOptions } from "./use-writer";

export interface CreateWriterOptions extends WriterOptions {
  /** Cancels both the (optional) download and `Writer.create()` call. */
  signal?: AbortSignal;
}

/**
 * Imperative `Writer` factory for options decided mid-flow. Uses the same
 * provisioning rules as {@link useWriter}, but returns one promise rather than
 * reactive lifecycle state.
 *
 * Throws `UnsupportedError`, `UnavailableError`, or
 * `MissingUserActivationError` — a user activation is required only to start
 * a download; one already in flight is joined gesture-free. Call from a
 * user-activation handler when a download may need starting, or pre-warm via
 * {@link useWriter}. Other browser rejections (e.g. `AbortError` when
 * `signal` fires, `NetworkError` on download failure) surface unchanged. The
 * returned instance is `AsyncDisposable`; prefer `await using` to release on
 * scope exit.
 *
 * @example
 * ```ts
 * await using writer = await createWriter({ tone: "formal", signal });
 * return await writer.write(prompt);
 * ```
 */
export async function createWriter(
  options: CreateWriterOptions = {},
): Promise<Writer & AsyncDisposable> {
  const { signal, ...createOptions } = options;
  return provisionStandalone<typeof createOptions, Writer>(
    "Writer",
    createOptions,
    signal,
  );
}
