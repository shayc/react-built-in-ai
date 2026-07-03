import { UnsupportedError } from "./errors";
import { getNamespace } from "./internal/lifecycle/types";
import type { BuiltInAIName } from "./is-supported";

/**
 * Probes real on-device readiness for `name` without creating an instance —
 * the browser's own `availability()` vocabulary (`"available"`,
 * `"downloadable"`, `"downloading"`, or `"unavailable"`). Unlike `isSupported`
 * (which only checks that the global exists), this tells you whether the
 * model can actually run, needs a download, or is already downloading.
 *
 * This is the same probe every hook and creator runs internally before
 * provisioning — exposed directly for call sites that need a readiness
 * answer without mounting a hook with concrete options (e.g. a capability
 * list rendered before the user has picked any).
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
export async function checkAvailability<Options extends object>(
  name: BuiltInAIName,
  options?: Options,
): Promise<Availability> {
  const namespace = getNamespace<Options, DestroyableModel>(name);
  if (!namespace) {
    throw new UnsupportedError();
  }
  return namespace.availability(options);
}
