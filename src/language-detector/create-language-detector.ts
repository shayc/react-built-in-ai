import { createInstance } from "../internal/lifecycle/create-instance";
import type { LanguageDetectorOptions } from "./use-language-detector";

/**
 * Options for {@link createLanguageDetector}. Mirrors
 * {@link LanguageDetectorOptions} plus an optional cancellation signal.
 */
export interface CreateLanguageDetectorOptions extends LanguageDetectorOptions {
  /** Cancels both the (optional) download and `LanguageDetector.create()` call. */
  signal?: AbortSignal;
}

/**
 * Imperative `LanguageDetector` factory. Mirrors the
 * {@link useLanguageDetector} lifecycle for call sites that decide options
 * mid-flow and can't render a hook.
 *
 * Throws {@link UnsupportedError}, {@link UnavailableError}, or
 * {@link NoUserActivationError} — call from a user-activation handler when a
 * download may be required, or pre-warm via {@link useLanguageDetector}. Other
 * browser rejections (e.g. `AbortError` when `signal` fires, `NetworkError` on
 * download failure) surface unchanged; use `instanceof BuiltInAIError` to
 * separate library errors from pass-through rejections. The returned instance
 * is `AsyncDisposable`; prefer `await using` to release on scope exit.
 *
 * @example
 * ```ts
 * await using detector = await createLanguageDetector({ signal });
 * const [top] = await detector.detect(text);
 * ```
 */
export async function createLanguageDetector(
  options: CreateLanguageDetectorOptions = {},
): Promise<LanguageDetector & AsyncDisposable> {
  const { signal, ...createOptions } = options;
  return createInstance<typeof createOptions, LanguageDetector>({
    name: "LanguageDetector",
    options: createOptions,
    signal,
  });
}
