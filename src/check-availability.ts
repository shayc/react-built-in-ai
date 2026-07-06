import { UnsupportedError } from "./errors";
import { getNamespace } from "./internal/lifecycle/types";
import type { BuiltInAIName } from "./is-supported";

/** Re-exports `Availability` under a nameable type for consumers. */
export type BuiltInAIAvailability = Availability;

/**
 * Maps each {@link BuiltInAIName} to the options its `availability()` call
 * accepts — the `*CreateCoreOptions` shape, not the `*CreateOptions` used by
 * `create()` (which adds create-only members like `sharedContext` that
 * `availability()` ignores).
 */
export interface AvailabilityOptionsMap {
  Translator: TranslatorCreateCoreOptions;
  Rewriter: RewriterCreateCoreOptions;
  Proofreader: ProofreaderCreateCoreOptions;
  Summarizer: SummarizerCreateCoreOptions;
  Writer: WriterCreateCoreOptions;
  LanguageDetector: LanguageDetectorCreateCoreOptions;
  LanguageModel: LanguageModelCreateCoreOptions;
}

/**
 * Probes real on-device readiness for `name` without creating an instance —
 * the browser's own `availability()` vocabulary (`"available"`,
 * `"downloadable"`, `"downloading"`, or `"unavailable"`). Unlike `isSupported`
 * (which only checks that the global exists), this tells you whether the
 * model can actually run, needs a download, or is already downloading.
 *
 * This is the same probe every hook and creator runs internally before
 * provisioning — exposed directly for call sites that need a readiness
 * answer without mounting a hook with concrete options.
 *
 * `Translator` requires a language pair to answer meaningfully, so its
 * options are mandatory here too; iterating {@link BuiltInAIName} option-free
 * for a capability list doesn't type-check for `Translator` — use
 * `isSupported("Translator")` for the existence check, or supply a language
 * pair to probe real availability.
 *
 * @throws {UnsupportedError} when `name`'s global namespace is absent —
 * combine with `isSupported` if you'd rather branch on that case yourself.
 *
 * @example
 * ```ts
 * const availability = await checkAvailability("Translator", {
 *   sourceLanguage: "en",
 *   targetLanguage: "es",
 * });
 * ```
 */
export async function checkAvailability(
  name: "Translator",
  options: TranslatorCreateCoreOptions,
): Promise<Availability>;
export async function checkAvailability<
  Name extends Exclude<BuiltInAIName, "Translator">,
>(name: Name, options?: AvailabilityOptionsMap[Name]): Promise<Availability>;
export async function checkAvailability(
  name: BuiltInAIName,
  options?: object,
): Promise<Availability> {
  const namespace = getNamespace<object, DestroyableModel>(name);
  if (!namespace) {
    throw new UnsupportedError();
  }
  return namespace.availability(options);
}
