import { provisionStandalone } from "../internal/lifecycle/provision";
import type { RewriterOptions } from "./use-rewriter";

/**
 * Options for {@link createRewriter}. Mirrors {@link RewriterOptions} plus an
 * optional cancellation signal.
 */
export interface CreateRewriterOptions extends RewriterOptions {
  /** Cancels both the (optional) download and `Rewriter.create()` call. */
  signal?: AbortSignal;
}

/**
 * Imperative `Rewriter` factory. Mirrors the {@link useRewriter} lifecycle for
 * call sites that decide options mid-flow and can't render a hook.
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
  const { signal, ...createOptions } = options;
  return provisionStandalone<typeof createOptions, Rewriter>(
    "Rewriter",
    createOptions,
    signal,
  );
}
