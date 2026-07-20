import { provisionStandalone } from "../internal/lifecycle/provision";
import type { LanguageDetectorOptions } from "./use-language-detector";

export interface CreateLanguageDetectorOptions extends LanguageDetectorOptions {
  /** Cancels both the (optional) download and `LanguageDetector.create()` call. */
  signal?: AbortSignal;
}

/**
 * Imperative `LanguageDetector` factory for options decided mid-flow. Uses the
 * same provisioning rules as {@link useLanguageDetector}, but returns one
 * promise rather than reactive lifecycle state.
 *
 * Throws `UnsupportedError`, `UnavailableError`, or
 * `MissingUserActivationError` — a user activation is required only to start
 * a download; one already in flight is joined gesture-free. Call from a
 * user-activation handler when a download may need starting, or pre-warm via
 * {@link useLanguageDetector}. Other browser rejections (e.g. `AbortError`
 * when `signal` fires, `NetworkError` on download failure) surface unchanged.
 * The returned instance is `AsyncDisposable`; prefer `await using` to release
 * on scope exit.
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
  return provisionStandalone<typeof createOptions, LanguageDetector>(
    "LanguageDetector",
    createOptions,
    signal,
  );
}
