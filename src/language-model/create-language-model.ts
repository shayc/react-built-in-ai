import { provisionStandalone } from "../internal/lifecycle/provision";
import type { LanguageModelOptions } from "./use-language-model";

/**
 * Options for {@link createLanguageModel}. Mirrors {@link LanguageModelOptions}
 * plus an optional cancellation signal.
 */
export interface CreateLanguageModelOptions extends LanguageModelOptions {
  /** Cancels both the (optional) download and `LanguageModel.create()` call. */
  signal?: AbortSignal;
}

/**
 * Imperative `LanguageModel` factory. Mirrors the {@link useLanguageModel}
 * download lifecycle for call sites that decide options mid-flow and can't
 * render a hook — and is the escape hatch to the raw session (for `clone()`,
 * the clone-per-call few-shot pattern, or direct `destroy()` control), which
 * the hook deliberately hides.
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
  const { signal, ...createOptions } = options;
  return provisionStandalone<typeof createOptions, LanguageModel>(
    "LanguageModel",
    createOptions,
    signal,
  );
}
