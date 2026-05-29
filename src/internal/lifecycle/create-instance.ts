import {
  MissingUserActivationError,
  UnavailableError,
  UnsupportedError,
} from "../../errors";
import type { BuiltInAIName } from "../../is-supported";
import {
  buildProgressKey,
  clearDownloadProgress,
  setDownloadProgress,
} from "../progress-store";
import { hasUserActivation } from "../user-activation";
import { getNamespace } from "./types";

/** @internal */
export interface CreateInstanceOptions<O extends object> {
  /** Built-in AI global namespace name (`"Translator"`, `"Rewriter"`, …). */
  name: BuiltInAIName;
  /** Browser `create()` options, forwarded verbatim. */
  options: O | undefined;
  /** Cancels both the (optional) download and `namespace.create()`. */
  signal?: AbortSignal;
  /** Called on each `downloadprogress` event with `event.loaded` in `[0, 1]`. */
  onProgress?: (progress: number) => void;
}

/**
 * Shared path behind every entry point: namespace lookup → availability →
 * user-activation check → `create()` with progress wiring → cleanup.
 *
 * Maps known conditions to typed errors (`UnsupportedError`,
 * `UnavailableError`, `MissingUserActivationError`); browser `availability()` /
 * `create()` rejections pass through unchanged. Writes download progress to the
 * shared store and clears it in `finally`. The returned instance is wrapped as
 * `AsyncDisposable` (a no-op if it already implements `[Symbol.asyncDispose]`).
 *
 * @internal
 */
export async function createInstance<
  O extends object,
  I extends DestroyableModel,
>(params: CreateInstanceOptions<O>): Promise<I & AsyncDisposable> {
  const { name, options, signal, onProgress } = params;

  const namespace = getNamespace<O, I>(name);
  if (!namespace) {
    throw new UnsupportedError();
  }

  const availability = await namespace.availability(options);
  if (availability === "unavailable") {
    throw new UnavailableError();
  }

  const willDownload = availability !== "available";
  if (willDownload && !hasUserActivation()) {
    throw new MissingUserActivationError();
  }

  const key = willDownload ? buildProgressKey(name, options) : null;
  try {
    if (key) {
      setDownloadProgress(key, 0);
    }
    const instance = await namespace.create({
      ...options!,
      signal,
      monitor: willDownload
        ? (monitor) =>
            monitor.addEventListener("downloadprogress", (event) => {
              onProgress?.(event.loaded);
              if (key) {
                setDownloadProgress(key, event.loaded);
              }
            })
        : undefined,
    });
    const disposable = instance as I & Partial<AsyncDisposable>;
    disposable[Symbol.asyncDispose] ??= () =>
      Promise.resolve(disposable.destroy());
    return disposable as I & AsyncDisposable;
  } finally {
    if (key) {
      clearDownloadProgress(key);
    }
  }
}
