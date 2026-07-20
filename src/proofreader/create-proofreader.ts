import { provisionStandalone } from "../internal/lifecycle/provision";
import type { ProofreaderOptions } from "./use-proofreader";

export interface CreateProofreaderOptions extends ProofreaderOptions {
  /** Cancels both the (optional) download and `Proofreader.create()` call. */
  signal?: AbortSignal;
}

/**
 * Imperative `Proofreader` factory for options decided mid-flow. Uses the same
 * provisioning rules as {@link useProofreader}, but returns one promise rather
 * than reactive lifecycle state.
 *
 * Throws `UnsupportedError`, `UnavailableError`, or
 * `MissingUserActivationError` — a user activation is required only to start
 * a download; one already in flight is joined gesture-free. Call from a
 * user-activation handler when a download may need starting, or pre-warm via
 * {@link useProofreader}. Other browser rejections (e.g. `AbortError` when
 * `signal` fires, `NetworkError` on download failure) surface unchanged. The
 * returned instance is `AsyncDisposable`; prefer `await using` to release on
 * scope exit.
 *
 * @example
 * ```ts
 * await using proofreader = await createProofreader({
 *   expectedInputLanguages: ["en"],
 *   signal,
 * });
 * return await proofreader.proofread(text);
 * ```
 */
export async function createProofreader(
  options: CreateProofreaderOptions = {},
): Promise<Proofreader & AsyncDisposable> {
  const { signal, ...createOptions } = options;
  return provisionStandalone<typeof createOptions, Proofreader>(
    "Proofreader",
    createOptions,
    signal,
  );
}
