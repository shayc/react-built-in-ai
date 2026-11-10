import { provisionStandalone } from "../internal/lifecycle/provision";
import type { TranslatorOptions } from "./use-translator";

export interface CreateTranslatorOptions extends TranslatorOptions {
  /** Cancels both the (optional) download and `Translator.create()` call. */
  signal?: AbortSignal;
  /**
   * Called with the download fraction in `[0, 1]` when creating the instance
   * involves a model download: once with `0` as soon as the download is
   * known, then on each browser `downloadprogress` event that changes the
   * value. Never called when the model is already available, nor after the
   * returned promise settles. Not forwarded to the browser's `create()`.
   */
  onDownloadProgress?: (progress: number) => void;
}

/**
 * Imperative `Translator` factory for call sites that decide the language pair
 * mid-flow. Uses the same provisioning rules as {@link useTranslator}, but
 * returns one promise rather than reactive lifecycle state.
 *
 * Throws `UnsupportedError`, `UnavailableError`, or
 * `MissingUserActivationError` — a user activation is required only to start
 * a download; one already in flight is joined gesture-free. Call from a
 * user-activation handler when a download may need starting, or pre-warm via
 * {@link useTranslator}. Other browser rejections (e.g. `AbortError` when
 * `signal` fires, `NetworkError` on download failure) surface unchanged. The
 * returned instance is `AsyncDisposable`; prefer `await using` to release on
 * scope exit.
 *
 * @example
 * ```ts
 * await using translator = await createTranslator({
 *   sourceLanguage: "en",
 *   targetLanguage: "es",
 *   signal,
 * });
 * return await translator.translate(text);
 * ```
 */
export async function createTranslator(
  options: CreateTranslatorOptions,
): Promise<Translator & AsyncDisposable> {
  const { signal, onDownloadProgress, ...createOptions } = options;
  return provisionStandalone<typeof createOptions, Translator>(
    "Translator",
    createOptions,
    signal,
    onDownloadProgress,
  );
}
