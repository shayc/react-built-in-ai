import { createInstance } from "../internal/lifecycle/create-instance";
import type { ProofreaderOptions } from "./use-proofreader";

/**
 * Options for {@link createProofreader}. Mirrors {@link ProofreaderOptions} plus
 * an optional cancellation signal.
 */
export interface CreateProofreaderOptions extends ProofreaderOptions {
  /** Cancels both the (optional) download and `Proofreader.create()` call. */
  signal?: AbortSignal;
}

/**
 * Imperative `Proofreader` factory. Mirrors the {@link useProofreader}
 * lifecycle for call sites that decide options mid-flow and can't render a
 * hook.
 *
 * Throws {@link UnsupportedError}, {@link UnavailableError}, or
 * {@link MissingUserActivationError} — call from a user-activation handler when a
 * download may be required, or pre-warm via {@link useProofreader}. Other
 * browser rejections (e.g. `AbortError` when `signal` fires, `NetworkError`
 * on download failure) surface unchanged; use `instanceof BuiltInAIError` to
 * separate library errors from pass-through rejections. The returned instance
 * is `AsyncDisposable`; prefer `await using` to release on scope exit.
 *
 * @example
 * ```ts
 * await using proofreader = await createProofreader({
 *   includeCorrectionTypes: true,
 *   signal,
 * });
 * return await proofreader.proofread(text);
 * ```
 */
export async function createProofreader(
  options: CreateProofreaderOptions = {},
): Promise<Proofreader & AsyncDisposable> {
  const { signal, ...createOptions } = options;
  return createInstance<typeof createOptions, Proofreader>({
    name: "Proofreader",
    options: createOptions,
    signal,
  });
}
