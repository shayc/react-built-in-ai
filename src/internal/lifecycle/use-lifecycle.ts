import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BuiltInAIName } from "../../is-supported";
import { buildKey, lookup, release, retain, type Store } from "./registry";
import { createStore } from "./store";

/**
 * Shared lifecycle for every built-in AI namespace. Hooks with equal options
 * share one store — one browser instance, one status — via a module-level
 * registry keyed by (namespace, options) identity; the last unmount tears it
 * down. `prepare`/`acquire` stay referentially stable for the component's
 * whole lifetime (including across an options change, which swaps the
 * underlying store) — the per-API hooks memoize their action methods in a
 * `useState` initializer that only runs once, so it closes over whatever
 * `acquire`/`prepare` it's handed on the first render forever.
 *
 * @internal
 */
export function useLifecycle<
  Options extends object,
  Model extends DestroyableModel,
>(
  globalName: BuiltInAIName,
  options: Options | undefined,
  readQuota?: (instance: Model) => number,
) {
  const key = buildKey(globalName, options);

  const [store, setStore] = useState<Store<Options, Model>>(
    () =>
      lookup<Options, Model>(key) ??
      createStore<Options, Model>(globalName, options, readQuota),
  );
  // Tracks the key the current `store` was resolved for, so a change can be
  // detected and adjusted for during render — the supported React pattern
  // for resetting state when a derived value changes. String equality alone
  // is sufficient (no shallow/array comparison needed): buildKey's sorted-JSON
  // encoding already collapses content-equal-but-differently-referenced
  // options (inline arrays, fresh object literals) to the same key.
  const [committedKey, setCommittedKey] = useState(key);
  if (committedKey !== key) {
    setCommittedKey(key);
    setStore(
      lookup<Options, Model>(key) ??
        createStore<Options, Model>(globalName, options, readQuota),
    );
  }

  useEffect(() => {
    const live = retain<Options, Model>(key, store);
    if (live !== store) {
      // A sibling using the same options already won the retain race for
      // this key (see registry.ts's `retain`) — adopt its store instead of
      // the (never-started, now-discarded) candidate. This is a legitimate
      // "synchronize with an external system" setState (the registry is the
      // external system; render can't consult it — see D2 in
      // PLAN-store-registry.md), not the props-mirroring pattern the
      // set-state-in-effect rule warns about.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStore(live);
    }
    return () => release(key);
    // `store` is intentionally omitted: this effect's job is to retain/
    // release exactly once per key generation, not to re-run when the
    // reconciliation above swaps `store` to the sibling's instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Kept current via an effect (not during render) so `stable.prepare`/
  // `stable.acquire` — captured once, see below — always dispatch to
  // whichever store is currently live, without a render-phase ref mutation.
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
  });

  const [stable] = useState(() => ({
    prepare: (): Promise<void> => storeRef.current.prepare(),
    acquire: (callerSignal?: AbortSignal) =>
      storeRef.current.acquire(callerSignal),
  }));

  // getSnapshot doubles as the server snapshot: a store can't leave
  // "checking" until its retaining effect runs, so server render and
  // hydration agree.
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return {
    status: snapshot.status,
    progress: snapshot.progress,
    error: snapshot.error,
    inputQuota: snapshot.inputQuota,
    prepare: stable.prepare,
    acquire: stable.acquire,
  };
}
