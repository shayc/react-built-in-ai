import {
  MissingUserActivationError,
  UnavailableError,
  UnsupportedError,
} from "../../errors";
import type { BuiltInAIName } from "../../is-supported";
import { hasUserActivation } from "../user-activation";
import { externalDownload } from "./registry";
import { getNamespace, type AINamespace } from "./types";

/** @internal */
interface ProvisionInstanceOptions<
  Options extends object,
  Model extends DestroyableModel,
> {
  namespace: AINamespace<Options, Model>;
  options: Options | undefined;
  /** `availability()` result the caller already probed. */
  availability: Availability;
  signal?: AbortSignal;
  /**
   * Called once, synchronously, when a download is involved (initiated or
   * joined) — after the user-activation gate has passed and before
   * `create()`. Never called when the gate rejects or the model is
   * already available.
   */
  onDownloadStart?: () => void;
  /** Called on each `downloadprogress` event with `event.loaded` in `[0, 1]`. */
  onProgress?: (progress: number) => void;
}

/**
 * Single user-activation gate for the whole library: `create()` needs a
 * transient activation whenever a download must be initiated. Joining an
 * already-in-flight download (`availability === "downloading"`) is
 * gesture-free — activation authorizes starting a fetch, and an in-flight
 * one was already authorized by whoever started it. Wires the download
 * monitor whenever a download is involved (initiated or joined), and wraps
 * the result as `AsyncDisposable`.
 *
 * Assumes `availability !== "unavailable"` — callers reject on that value
 * before reaching here, since it's not a `create()`-time concern.
 *
 * @internal
 */
export async function provisionInstance<
  Options extends object,
  Model extends DestroyableModel,
>(
  params: ProvisionInstanceOptions<Options, Model>,
): Promise<Model & AsyncDisposable> {
  const {
    namespace,
    options,
    availability,
    signal,
    onDownloadStart,
    onProgress,
  } = params;

  const requiresActivation = availability === "downloadable";
  if (requiresActivation && !hasUserActivation()) {
    throw new MissingUserActivationError();
  }

  const willDownload = availability !== "available";
  if (willDownload) {
    onDownloadStart?.();
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
  const disposable = instance as Model & Partial<AsyncDisposable>;
  disposable[Symbol.asyncDispose] ??= () =>
    Promise.resolve(disposable.destroy());
  return disposable as Model & AsyncDisposable;
}

/**
 * Imperative-creator path: resolve the namespace, probe availability, and
 * provision — the store handles its own probing separately (it already knows
 * `availability` by the time it needs an instance).
 *
 * Its download is an `externalDownload` (see `registry.ts`), so
 * `useGlobalDownloadProgress` sees it alongside hook-driven downloads. It is
 * started from `provisionInstance`'s `onDownloadStart` — only once the
 * user-activation gate has passed, so a download that may not start is never
 * reported — and ended in `finally`.
 *
 * `onDownloadProgress` is the caller's own view of that same download: `0`
 * when it starts, while the aggregate already reports it, then each distinct
 * `downloadprogress` fraction. It never fires when the model is already
 * available, when the activation gate rejects, nor once the returned promise
 * has settled.
 *
 * @internal
 */
export async function provisionStandalone<
  Options extends object,
  Model extends DestroyableModel,
>(
  globalName: BuiltInAIName,
  options: Options | undefined,
  signal?: AbortSignal,
  onDownloadProgress?: (progress: number) => void,
): Promise<Model & AsyncDisposable> {
  const namespace = getNamespace<Options, Model>(globalName);
  if (!namespace) {
    throw new UnsupportedError();
  }

  const availability = await namespace.availability(options);
  if (availability === "unavailable") {
    throw new UnavailableError();
  }

  const download = externalDownload(globalName, onDownloadProgress);
  try {
    return await provisionInstance<Options, Model>({
      namespace,
      options,
      availability,
      signal,
      onDownloadStart: download.start,
      onProgress: download.report,
    });
  } finally {
    download.end();
  }
}
