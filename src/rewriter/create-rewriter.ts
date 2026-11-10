import { provisionStandalone } from "../internal/lifecycle/provision";
import type { RewriterOptions } from "./use-rewriter";

export interface CreateRewriterOptions extends RewriterOptions {
  /** Cancels both the (optional) download and `Rewriter.create()` call. */
  signal?: AbortSignal;
  /**
   * Called with the download fraction in `[0, 1]` when creating the instance
   * involves a model download: once with `0` as soon as the download is
   * known, then on each browser `downloadprogress` event that changes the
   * value. Never called when the model is already available, when the call
   * rejects with `MissingUserActivationError`, nor after the returned promise
   * settles. Not forwarded to the browser's `create()`.
   */
  onDownloadProgress?: (progress: number) => void;
}

/**
 * Imperative `Rewriter` factory for options decided mid-flow. Uses the same
 * provisioning rules as {@link useRewriter}, but returns one promise rather
 * than reactive lifecycle state.
 *
 * Throws `UnsupportedError`, `UnavailableError`, or
 * `MissingUserActivationError` — a user activation is required only to start
 * a download; one already in flight is joined gesture-free. Call from a
 * user-activation handler when a download may need starting, or pre-warm via
 * {@link useRewriter}. Other browser rejections (e.g. `AbortError` when
 * `signal` fires, `NetworkError` on download failure) surface unchanged. The
 * returned instance is `AsyncDisposable`; prefer `await using` to release on
 * scope exit.
 *
 * @example
 * ```ts
 * await using rewriter = await createRewriter({ tone: "more-formal", signal });
 * return await rewriter.rewrite(text);
 * ```
 */
export async function createRewriter(
  options: CreateRewriterOptions = {},
): Promise<Rewriter & AsyncDisposable> {
  const { signal, onDownloadProgress, ...createOptions } = options;
  return provisionStandalone<typeof createOptions, Rewriter>(
    "Rewriter",
    createOptions,
    signal,
    onDownloadProgress,
  );
}
