import { provisionStandalone } from "../internal/lifecycle/provision";
import type { WriterOptions } from "./use-writer";

/**
 * Options for {@link createWriter}. Mirrors {@link WriterOptions} plus an
 * optional cancellation signal.
 */
export interface CreateWriterOptions extends WriterOptions {
  /** Cancels both the (optional) download and `Writer.create()` call. */
  signal?: AbortSignal;
}

/**
 * Imperative `Writer` factory. Mirrors the {@link useWriter} lifecycle for call
 * sites that decide options mid-flow and can't render a hook.
 *
 * Throws {@link UnsupportedError}, {@link UnavailableError}, or
 * {@link MissingUserActivationError} — a user activation is required only to
 * start a download; one already in flight is joined gesture-free. Call from a
 * user-activation handler when a download may need starting, or pre-warm via
 * {@link useWriter}. Other browser
 * rejections (e.g. `AbortError` when `signal` fires, `NetworkError` on
 * download failure) surface unchanged; use `instanceof BuiltInAIError` to
 * separate library errors from pass-through rejections. The returned instance
 * is `AsyncDisposable`; prefer `await using` to release on scope exit.
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
