import { useEffect, useState, useSyncExternalStore } from "react";
import type { BuiltInAIName } from "../../is-supported";
import { createStore } from "./store";

function arrayEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

// Option arrays (`expectedInputLanguages`, …) are flat lists of primitives, so
// one-level element-wise comparison is exhaustive.
function valueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  return Array.isArray(a) && Array.isArray(b) && arrayEqual(a, b);
}

function shallowEqual<T extends object>(
  a: T | undefined,
  b: T | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  const ar = a as Record<string, unknown>;
  const br = b as Record<string, unknown>;
  for (const k of keys) {
    if (!valueEqual(ar[k], br[k])) {
      return false;
    }
  }
  return true;
}

function useStableOptions<T extends object>(
  options: T | undefined,
): T | undefined {
  const [stable, setStable] = useState(options);
  if (!shallowEqual(stable, options)) {
    setStable(options);
  }
  return stable;
}

/**
 * Shared lifecycle for every built-in AI namespace. Function refs are stable
 * across renders.
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
  const stableOptions = useStableOptions(options);

  const [store] = useState(() =>
    createStore<Options, Model>(globalName, readQuota),
  );

  useEffect(() => {
    store.start(stableOptions);
    return () => store.stop();
  }, [store, stableOptions]);

  // getSnapshot doubles as the server snapshot: the store can't leave idle
  // until the mount effect runs, so server render and hydration agree.
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
    prepare: store.prepare,
    acquire: store.acquire,
  };
}
