import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BuiltInAIName } from "../../is-supported";
import { raceAbort } from "../signal";
import { buildKey, lookup, release, retain, type Store } from "./registry";
import { createStore } from "./store";

/**
 * Shared lifecycle for every built-in AI namespace. Hooks with equal options
 * share one store — one browser instance, one status — via a module-level
 * registry keyed by (namespace, options) identity; the last unmount tears it
 * down. `prepare`/`acquire` stay referentially stable for the component's
 * whole lifetime (including across an options change, which swaps the
 * underlying store) — the per-API hooks capture them once in a `useState`
 * initializer and never again, so an unstable reference would go stale
 * after the first render.
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

  // Kept current inside the retain effect below (not via a separate
  // per-render effect) so `stable.prepare`/`stable.acquire` — captured once,
  // see below — always dispatch to whichever store actually won the retain
  // race, never a discarded candidate. A second, dep-less effect writing
  // `storeRef.current = store` here would close over the pre-adoption
  // `store` until the `setStore(live)` re-render commits, letting an
  // in-between `prepare`/`acquire` call reach the never-started candidate.
  const storeRef = useRef(store);
  // Resolved by the first retain effect. Until then the store is an unstarted
  // candidate, and a call that reaches it — from a child's mount effect or a
  // layout effect, both of which run before this hook's passive effect — would
  // be aborted by the `start()` that follows. Hand-rolled rather than
  // `Promise.withResolvers` so rendering a hook stays safe on browsers that
  // predate it.
  const [mounted] = useState(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  });
  useEffect(() => {
    const live = retain<Options, Model>(key, store);
    storeRef.current = live;
    mounted.resolve();
    if (live !== store) {
      // A sibling using the same options already won the retain race for
      // this key (see registry.ts's `retain`) — adopt its store instead of
      // the (never-started, now-discarded) candidate. This is a legitimate
      // "synchronize with an external system" setState (the registry is the
      // external system; render's `lookup()` is only an optimistic read that
      // a concurrent render or interleaved release can invalidate, so the
      // effect must reconcile), not the props-mirroring pattern the
      // set-state-in-effect rule warns about.
      setStore(live);
    }
    return () => release(key);
    // `store` is intentionally omitted: this effect's job is to retain/
    // release exactly once per key generation, not to re-run when the
    // reconciliation above swaps `store` to the sibling's instance.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [key]);

  const [stable] = useState(() => ({
    // Both wait for the retain effect, then read `storeRef` — so they always
    // dispatch to a started store. Once mounted, the await is a single
    // microtask, which still lands after the current effect flush: a child
    // effect that fires on an options change reaches the new key's store
    // rather than the one being released. Transient user activation survives
    // the microtask, so the download gate is unaffected.
    prepare: async (): Promise<void> => {
      await mounted.promise;
      return storeRef.current.prepare();
    },
    acquire: async (callerSignal?: AbortSignal) => {
      await (callerSignal
        ? raceAbort(mounted.promise, callerSignal)
        : mounted.promise);
      return storeRef.current.acquire(callerSignal);
    },
  }));

  // getSnapshot doubles as the server snapshot: a store can't leave
  // "checking" until its retaining effect runs, so a component hydrating in
  // isolation always agrees with its own server render. Under
  // streaming/selective hydration this can still mismatch across
  // boundaries: a same-key sibling that hydrated earlier may have already
  // retained and advanced the shared store to "ready" by the time this
  // boundary hydrates, so the client snapshot here can read "ready" against
  // a server-rendered "checking". React patches this up as an ordinary
  // hydration mismatch; it isn't a bug.
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
