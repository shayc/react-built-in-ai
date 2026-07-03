import { useSyncExternalStore } from "react";
import {
  snapshotDownloadProgress,
  subscribeDownloads,
} from "./internal/lifecycle/registry";
import type { BuiltInAIName } from "./is-supported";

/**
 * Progress of the least-complete in-flight download across built-in AI
 * instances. Tracks downloads started by hooks and by the imperative
 * `create*` factories alike; for per-instance progress, read `progress` from
 * the hook return.
 *
 * Aggregating with min means a finishing download never snaps the value
 * backwards. It is not strictly monotonic: a download that starts mid-flight
 * joins at 0 and lowers the value — including a download observed passively
 * (started elsewhere: another hook, another tab, an imperative creator) that
 * hasn't yet reported a real fraction. `0` here means "in flight with no
 * progress signal yet" as often as it means a genuine browser-reported 0;
 * either way, treat it as "downloading, percentage unknown". Finished
 * downloads leave the store, so the value returns to `null` (rather than
 * reporting `1`) once every matching download completes — key "done" off
 * `null`, not `progress === 1`.
 *
 * @param namespaces - Restrict aggregation to one API or an array of APIs.
 * Omit (or pass `undefined`) to aggregate across every built-in AI download
 * currently in flight.
 * @returns Progress in `[0, 1]` while a download is in flight; `null` when
 * nothing is downloading. `null` (not `0`) lets callers tell "no download"
 * apart from "download just started at 0%".
 *
 * @example
 * ```tsx
 * function SuggestionDownloadBar() {
 *   const progress = useGlobalDownloadProgress(["Proofreader", "Rewriter"]);
 *   if (progress === null) return null;
 *   return <ProgressBar value={progress} />;
 * }
 * ```
 */
export function useGlobalDownloadProgress(
  namespaces?: BuiltInAIName | readonly BuiltInAIName[],
): number | null {
  const prefixes = toPrefixes(namespaces);
  return useSyncExternalStore(
    subscribeDownloads,
    () => snapshotDownloadProgress(prefixes),
    // No download can be in flight during SSR.
    () => null,
  );
}

function toPrefixes(
  namespaces: BuiltInAIName | readonly BuiltInAIName[] | undefined,
): readonly string[] {
  if (namespaces === undefined) {
    return [];
  }
  return typeof namespaces === "string" ? [namespaces] : namespaces;
}
