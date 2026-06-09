const progressByKey = new Map<string, number>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDownloadProgress(key: string, progress: number): void {
  if (progressByKey.get(key) === progress) {
    return;
  }
  progressByKey.set(key, progress);
  notify();
}

export function clearDownloadProgress(key: string): void {
  if (!progressByKey.delete(key)) {
    return;
  }
  notify();
}

/**
 * Lowest progress among matching keys — the download with the longest to go —
 * or `null` when none are in flight. `null` (not `0`) tells "nothing
 * downloading" apart from "just started at 0%".
 *
 * Min, not max: a finished download leaves the map, so max would snap
 * backwards to the next-furthest-behind download. Min only ever rises as
 * downloads complete (though a download starting mid-flight joins at 0 and
 * lowers it). Because completed downloads are cleared, the snapshot returns
 * to `null` — never `1` — once the last matching download finishes.
 *
 * @internal
 */
export function snapshotProgressFor(
  prefixes: readonly string[],
): number | null {
  let min: number | null = null;
  for (const [key, progress] of progressByKey) {
    if (
      prefixes.length > 0 &&
      !prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))
    ) {
      continue;
    }
    min = min === null ? progress : Math.min(min, progress);
  }
  return min;
}

/**
 * Stable progress-store key for an instance distinguished by `options`. Keys
 * are sorted before JSON encoding so insertion order doesn't split the same
 * logical options into separate entries.
 *
 * @internal
 */
export function buildProgressKey(
  globalName: string,
  options: object | undefined,
): string {
  if (!options) {
    return globalName;
  }
  const keys = Object.keys(options).sort();
  if (keys.length === 0) {
    return globalName;
  }
  const ordered = Object.fromEntries(
    keys.map((k) => [k, (options as Record<string, unknown>)[k]]),
  );
  return `${globalName}:${JSON.stringify(ordered)}`;
}
