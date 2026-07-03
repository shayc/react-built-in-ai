import {
  MissingUserActivationError,
  UnavailableError,
  UnsupportedError,
} from "../../errors";
import type { BuiltInAIName } from "../../is-supported";
import { hasUserActivation } from "../user-activation";
import {
  beginExternalDownload,
  buildKey,
  endExternalDownload,
  updateExternalDownload,
} from "./registry";
import { getNamespace, type AINamespace } from "./types";

/** @internal */
export interface ProvisionInstanceOptions<
  O extends object,
  I extends DestroyableModel,
> {
  /** Namespace already resolved by the caller. */
  namespace: AINamespace<O, I>;
  /** Browser `create()` options, forwarded verbatim. */
  options: O | undefined;
  /** `availability()` result the caller already probed. */
  availability: Availability;
  /** Cancels `create()`. */
  signal?: AbortSignal;
  /** Called on each `downloadprogress` event with `event.loaded` in `[0, 1]`. */
  onProgress?: (progress: number) => void;
}

/**
 * Single user-activation gate for the whole library: `create()` needs a
 * transient activation whenever a download is required. Wires the download
 * monitor when one is, and wraps the result as `AsyncDisposable`.
 *
 * Assumes `availability !== "unavailable"` — callers reject on that value
 * before reaching here, since it's not a `create()`-time concern.
 *
 * @internal
 */
export async function provisionInstance<
  O extends object,
  I extends DestroyableModel,
>(params: ProvisionInstanceOptions<O, I>): Promise<I & AsyncDisposable> {
  const { namespace, options, availability, signal, onProgress } = params;

  const willDownload = availability !== "available";
  if (willDownload && !hasUserActivation()) {
    throw new MissingUserActivationError();
  }

  const instance = await namespace.create({
    ...options!,
    signal,
    monitor: willDownload
      ? (monitor) =>
          monitor.addEventListener("downloadprogress", (event) => {
            onProgress?.(event.loaded);
          })
      : undefined,
  });
  const disposable = instance as I & Partial<AsyncDisposable>;
  disposable[Symbol.asyncDispose] ??= () =>
    Promise.resolve(disposable.destroy());
  return disposable as I & AsyncDisposable;
}

/**
 * Imperative-creator path: resolve the namespace, probe availability, and
 * provision — the store handles its own probing separately (it already knows
 * `availability` by the time it needs an instance).
 *
 * Registers its download with the registry's external-download tracker
 * (keyed by a fresh token, not by options — see `registry.ts`) so
 * `useGlobalDownloadProgress` sees it alongside hook-driven downloads, and
 * clears it in `finally`.
 *
 * @internal
 */
export async function provisionStandalone<
  O extends object,
  I extends DestroyableModel,
>(
  name: BuiltInAIName,
  options: O | undefined,
  signal?: AbortSignal,
): Promise<I & AsyncDisposable> {
  const namespace = getNamespace<O, I>(name);
  if (!namespace) {
    throw new UnsupportedError();
  }

  const availability = await namespace.availability(options);
  if (availability === "unavailable") {
    throw new UnavailableError();
  }

  const willDownload = availability !== "available";
  const token = willDownload
    ? beginExternalDownload(buildKey(name, options))
    : null;
  try {
    return await provisionInstance<O, I>({
      namespace,
      options,
      availability,
      signal,
      onProgress:
        token !== null
          ? (progress) => updateExternalDownload(token, progress)
          : undefined,
    });
  } finally {
    if (token !== null) {
      endExternalDownload(token);
    }
  }
}
