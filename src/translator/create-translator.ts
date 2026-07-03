import { provisionStandalone } from "../internal/lifecycle/provision";
import type { TranslatorOptions } from "./use-translator";

/**
 * Options for {@link createTranslator}. Mirrors {@link TranslatorOptions} plus
 * an optional cancellation signal.
 */
export interface CreateTranslatorOptions extends TranslatorOptions {
  /** Cancels both the (optional) download and `Translator.create()` call. */
  signal?: AbortSignal;
}

/**
 * Imperative `Translator` factory. Mirrors the {@link useTranslator} lifecycle
 * for call sites that decide the language pair mid-flow and can't render a
 * hook.
 *
 * Throws {@link UnsupportedError}, {@link UnavailableError}, or
 * {@link MissingUserActivationError} — a user activation is required only to
 * start a download; one already in flight is joined gesture-free. Call from a
 * user-activation handler when a download may need starting, or pre-warm via
 * {@link useTranslator}. Other
 * browser rejections (e.g. `AbortError` when `signal` fires, `NetworkError`
 * on download failure) surface unchanged; use `instanceof BuiltInAIError` to
 * separate library errors from pass-through rejections. The returned instance
 * is `AsyncDisposable`; prefer `await using` to release on scope exit.
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
  const { signal, ...createOptions } = options;
  return provisionStandalone<typeof createOptions, Translator>(
    "Translator",
    createOptions,
    signal,
  );
}
