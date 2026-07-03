import type { BuiltInAIName } from "../../is-supported";
import type { createStore } from "./store";

/** @internal */
export type Store<
  Options extends object,
  Model extends DestroyableModel,
> = ReturnType<typeof createStore<Options, Model>>;

interface Entry {
  store: Store<object, DestroyableModel>;
  refCount: number;
  unsubscribe: () => void;
}

const entries = new Map<string, Entry>();

/**
 * Canonical identity for a (namespace, options) pair — hooks with equal
 * options share one store. Keys are sorted before JSON encoding so
 * insertion order doesn't split the same logical options into separate
 * entries.
 *
 * @internal
 */
export function buildKey(
  globalName: BuiltInAIName,
  options: object | undefined,
): string {
  if (!options) {
    return globalName;
  }
  const keys = Object.keys(options).sort();
  const ordered = Object.fromEntries(
    keys.map((k) => [k, (options as Record<string, unknown>)[k]]),
  );
  const json = JSON.stringify(ordered);
  // JSON.stringify drops undefined-valued props, so an options object made
  // entirely of them (e.g. `{ foo: undefined }`) serializes to "{}" — the
  // same as an empty object. Collapse both to the bare name so they share
  // a store.
  return json === "{}" ? globalName : `${globalName}:${json}`;
}

/** The live store for `key`, if one is currently retained. @internal */
export function lookup<Options extends object, Model extends DestroyableModel>(
  key: string,
): Store<Options, Model> | undefined {
  return entries.get(key)?.store as Store<Options, Model> | undefined;
}

/**
 * Retains `key`. A live entry gets `refCount++` and its store back —
 * `candidate` was never started, so it's simply dropped. A miss inserts
 * `candidate` at `refCount = 1`, subscribes it into the download-progress
 * aggregate, and starts it.
 *
 * @internal
 */
export function retain<Options extends object, Model extends DestroyableModel>(
  key: string,
  candidate: Store<Options, Model>,
): Store<Options, Model> {
  const existing = entries.get(key);
  if (existing) {
    existing.refCount += 1;
    return existing.store as Store<Options, Model>;
  }
  const unsubscribe = candidate.subscribe(notifyDownloads);
  entries.set(key, { store: candidate, refCount: 1, unsubscribe });
  candidate.start();
  return candidate;
}

/** Releases `key`; the last release stops the store and drops the entry. @internal */
export function release(key: string): void {
  const existing = entries.get(key);
  if (!existing) {
    return;
  }
  existing.refCount -= 1;
  if (existing.refCount <= 0) {
    existing.unsubscribe();
    existing.store.stop();
    entries.delete(key);
    // The unsubscribe above means the store's own stop() transition can't
    // reach download listeners — if this entry was mid-download, its
    // disappearance must be announced explicitly or the aggregate freezes
    // at its last value instead of returning to null.
    notifyDownloads();
  }
}

// --- Global download-progress aggregation -----------------------------
//
// Two sources feed the aggregate:
//  - Retained stores (hook-driven downloads): read directly off each
//    store's own snapshot — no separate bookkeeping, since the store
//    already tracks its own `progress` while `status === "downloading"`.
//  - External downloads (imperative `create*` calls, which have no
//    retained store): tracked in `externalDownloads`, keyed by a unique
//    token per call rather than by options — so one aborted call among
//    several identical-options creators can't blank the others' progress
//    by clearing a key they still share.
//
// Both sources seed `progress: null` until the browser reports a real
// fraction — the aggregate coalesces `null` to `0` per-entry before taking
// the min, so an unsignaled download still shows up as "in flight" instead
// of vanishing from the aggregate.

const downloadListeners = new Set<() => void>();

function notifyDownloads(): void {
  for (const listener of downloadListeners) {
    listener();
  }
}

/** @internal */
export function subscribeDownloads(listener: () => void): () => void {
  downloadListeners.add(listener);
  return () => {
    downloadListeners.delete(listener);
  };
}

interface ExternalDownload {
  key: string;
  progress: number | null;
}

let nextExternalToken = 0;
const externalDownloads = new Map<number, ExternalDownload>();

/** Registers an in-flight imperative-creator download. Returns its token. @internal */
export function beginExternalDownload(key: string): number {
  const token = nextExternalToken;
  nextExternalToken += 1;
  // null, not 0: a number means the browser actually reported this fraction
  // via downloadprogress.
  externalDownloads.set(token, { key, progress: null });
  notifyDownloads();
  return token;
}

/** @internal */
export function updateExternalDownload(token: number, progress: number): void {
  const download = externalDownloads.get(token);
  if (!download || download.progress === progress) {
    return;
  }
  download.progress = progress;
  notifyDownloads();
}

/** @internal */
export function endExternalDownload(token: number): void {
  if (externalDownloads.delete(token)) {
    notifyDownloads();
  }
}

function matchesPrefix(key: string, prefixes: readonly string[]): boolean {
  return (
    prefixes.length === 0 ||
    prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))
  );
}

/**
 * Lowest progress among matching in-flight downloads — across both retained
 * stores and external creator calls — or `null` when none are in flight. A
 * download with no progress signal yet contributes `0` rather than dropping
 * out of the aggregate; `useGlobalDownloadProgress` documents the
 * consumer-facing rationale for min-aggregation and the `0` floor.
 *
 * @internal
 */
export function snapshotDownloadProgress(
  prefixes: readonly string[],
): number | null {
  let min: number | null = null;
  for (const [key, entry] of entries) {
    if (!matchesPrefix(key, prefixes)) {
      continue;
    }
    const snapshot = entry.store.getSnapshot();
    if (snapshot.status !== "downloading") {
      continue;
    }
    const progress = snapshot.progress ?? 0;
    min = min === null ? progress : Math.min(min, progress);
  }
  for (const { key, progress } of externalDownloads.values()) {
    if (!matchesPrefix(key, prefixes)) {
      continue;
    }
    const p = progress ?? 0;
    min = min === null ? p : Math.min(min, p);
  }
  return min;
}

/**
 * Test-only escape hatch: forcibly stops and drops every retained entry and
 * external download. The registry is module-level state that outlives any
 * single test: without this, a leaked retain (a hook that doesn't unmount
 * cleanly, or a test driving the store directly) would leave a stale entry
 * for the next test using the same key to silently inherit.
 *
 * @internal
 */
export function __resetForTests(): void {
  for (const entry of entries.values()) {
    entry.unsubscribe();
    entry.store.stop();
  }
  entries.clear();
  externalDownloads.clear();
}

/** Test-only: number of currently-retained entries. @internal */
export function __sizeForTests(): number {
  return entries.size;
}
