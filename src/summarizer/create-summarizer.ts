import { provisionStandalone } from "../internal/lifecycle/provision";
import type { SummarizerOptions } from "./use-summarizer";

export interface CreateSummarizerOptions extends SummarizerOptions {
  /** Cancels both the (optional) download and `Summarizer.create()` call. */
  signal?: AbortSignal;
}

/**
 * Imperative `Summarizer` factory for options decided mid-flow. Uses the same
 * provisioning rules as {@link useSummarizer}, but returns one promise rather
 * than reactive lifecycle state.
 *
 * Throws `UnsupportedError`, `UnavailableError`, or
 * `MissingUserActivationError` — a user activation is required only to start
 * a download; one already in flight is joined gesture-free. Call from a
 * user-activation handler when a download may need starting, or pre-warm via
 * {@link useSummarizer}. Other browser rejections (e.g. `AbortError` when
 * `signal` fires, `NetworkError` on download failure) surface unchanged. The
 * returned instance is `AsyncDisposable`; prefer `await using` to release on
 * scope exit.
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
  return provisionStandalone<typeof createOptions, Summarizer>(
    "Summarizer",
    createOptions,
    signal,
  );
}
