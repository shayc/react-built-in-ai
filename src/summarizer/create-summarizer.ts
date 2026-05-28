import { createInstance } from "../internal/lifecycle/create-instance";
import type { SummarizerOptions } from "./use-summarizer";

/**
 * Options for {@link createSummarizer}. Mirrors {@link SummarizerOptions} plus
 * an optional cancellation signal.
 */
export interface CreateSummarizerOptions extends SummarizerOptions {
  /** Cancels both the (optional) download and `Summarizer.create()` call. */
  signal?: AbortSignal;
}

/**
 * Imperative `Summarizer` factory. Mirrors the {@link useSummarizer} lifecycle
 * for call sites that decide options mid-flow and can't render a hook.
 *
 * Throws {@link UnsupportedError}, {@link UnavailableError}, or
 * {@link NoUserActivationError} — call from a user-activation handler when a
 * download may be required, or pre-warm via {@link useSummarizer}. Other
 * browser rejections (e.g. `AbortError` when `signal` fires, `NetworkError` on
 * download failure) surface unchanged; use `instanceof BuiltInAIError` to
 * separate library errors from pass-through rejections. The returned instance
 * is `AsyncDisposable`; prefer `await using` to release on scope exit.
 *
 * @example
 * ```ts
 * await using summarizer = await createSummarizer({ type: "tldr", signal });
 * return await summarizer.summarize(text);
 * ```
 */
export async function createSummarizer(
  options: CreateSummarizerOptions = {},
): Promise<Summarizer & AsyncDisposable> {
  const { signal, ...createOptions } = options;
  return createInstance<typeof createOptions, Summarizer>({
    name: "Summarizer",
    options: createOptions,
    signal,
  });
}
