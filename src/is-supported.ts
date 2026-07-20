/**
 * A built-in AI global the browser exposes when the matching API is enabled.
 *
 * @see https://developer.chrome.com/docs/ai/built-in
 */
export type BuiltInAIName =
  | "Translator"
  | "Rewriter"
  | "Proofreader"
  | "Summarizer"
  | "Writer"
  | "LanguageDetector"
  | "LanguageModel";

/**
 * Feature-detects a built-in AI namespace. A `true` result means the global
 * exists, not that the model can actually run — combine with the hook's
 * `status` (`"unavailable"`) for the full readiness picture.
 *
 * Within React, prefer mounting the hook and reading `status`; hooks provide a
 * server snapshot and initialize on the client. This utility is best used
 * outside React or to choose between separate components. Built-in AI globals
 * are absent on the server, so using it to select SSR markup can create a
 * hydration mismatch.
 *
 * @example
 * ```ts
 * const showTranslatorCommand = isSupported("Translator");
 * ```
 */
export function isSupported(name: BuiltInAIName): boolean {
  return (globalThis as Record<string, unknown>)[name] != null;
}
