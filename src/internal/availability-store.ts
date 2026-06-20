const listeners = new Set<(key: string) => void>();

/**
 * Subscribe to availability-invalidation events. The listener receives the
 * progress key (see {@link buildProgressKey}) whose device-wide availability may
 * have changed, so a parked instance can re-confirm its own
 * `availability(options)` and converge. Peer of the download-progress store: a
 * module-level registry that coordinates otherwise-independent lifecycle stores.
 *
 * @internal
 */
export function subscribeAvailability(
  listener: (key: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Announce that a download for `key` completed, so any sibling parked at
 * `downloadable` whose availability is now stale re-probes and converges to
 * `ready`. A pure edge nudge — it caches no value and dedupes nothing; each
 * listener re-confirms its own `availability(options)`, so a non-matching
 * sibling correctly stays parked.
 *
 * @internal
 */
export function invalidateAvailability(key: string): void {
  for (const listener of listeners) {
    listener(key);
  }
}
