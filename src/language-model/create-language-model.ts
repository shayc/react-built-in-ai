import { provisionStandalone } from "../internal/lifecycle/provision";
import type { LanguageModelOptions } from "./use-language-model";

export interface CreateLanguageModelOptions extends LanguageModelOptions {
  /** Cancels both the (optional) download and `LanguageModel.create()` call. */
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
 * Imperative `LanguageModel` factory for options decided mid-flow. Uses the
 * same provisioning rules as {@link useLanguageModel}, but returns one promise
 * rather than reactive lifecycle state. It is also the escape hatch to the raw
 * session for `clone()` and direct `destroy()` control.
 *
 * Throws `UnsupportedError`, `UnavailableError`, or
 * `MissingUserActivationError` — a user activation is required only to start a
 * download; one already in flight is joined gesture-free. Call from a
 * user-activation handler when a download may need starting, or pre-warm via
 * {@link useLanguageModel}. Other browser rejections (e.g. `AbortError` when
 * `signal` fires, `NetworkError` on download failure) surface unchanged. The
 * returned session is `AsyncDisposable`; prefer `await using` to release it on
 * scope exit.
 *
 * @example
 * ```ts
 * await using model = await createLanguageModel({
 *   initialPrompts: [{ role: "system", content: "You are a poet." }],
 *   signal,
 * });
 * return await model.prompt("Write a haiku about the sea.");
 * ```
 */
export async function createLanguageModel(
  options: CreateLanguageModelOptions = {},
): Promise<LanguageModel & AsyncDisposable> {
  const { signal, onDownloadProgress, ...createOptions } = options;
  return provisionStandalone<typeof createOptions, LanguageModel>(
    "LanguageModel",
    createOptions,
    signal,
    onDownloadProgress,
  );
}
