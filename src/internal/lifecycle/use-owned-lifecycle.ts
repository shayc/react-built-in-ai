import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BuiltInAIName } from "../../is-supported";
import { release, retain, type Store } from "./registry";
import { createStore } from "./store";

let nextToken = 0;

/**
 * Per-mount sibling of {@link useLifecycle}: each mount owns its own store and
 * never shares it. The tested lifecycle machine (availability probe,
 * user-activation download gate, gesture-free join of in-flight downloads,
 * epoch/abort reset, download monitoring) is reused wholesale — only the
 * registry's equal-options deduplication is bypassed, via a unique per-mount
 * key (`` `<name>:#<n>` ``).
 *
 * This exists because the Prompt API's sessions are stateful conversations
 * whose options (closures in `tools`, blobs in `initialPrompts`) can't be
 * structurally keyed — the two premises {@link useLifecycle}'s sharing relies
 * on. See the design notes in `useLanguageModel`.
 *
 * Options are captured once at mount and never re-read from props;
 * `replace(nextOptions?)` is the only way to change them (destroying the old
 * session and provisioning a fresh one), which backs the hook's `reset`.
 *
 * @internal
 */
export function useOwnedLifecycle<
  Options extends object,
  Model extends DestroyableModel,
>(
  globalName: BuiltInAIName,
  options: Options | undefined,
  readQuota?: (instance: Model) => number,
) {
  // Captured at mount, never re-read from render props — a stateful session
  // must not be torn down because a parent re-rendered with a fresh option
  // literal. Updated only by replace(nextOptions).
  const optionsRef = useRef(options);

  const [token, setToken] = useState(() => nextToken++);
  const [store, setStore] = useState<Store<Options, Model>>(() =>
    // `options` (not optionsRef.current) so no ref is read during render — the
    // two are equal on this first-render-only initializer anyway.
    createStore<Options, Model>(globalName, options, readQuota),
  );

  // Unique per mount and per replace(): the owned store must never share with
  // or be adopted by a sibling — the whole reason this hook exists instead of
  // useLifecycle. The `<name>:` prefix keeps useGlobalDownloadProgress(name)
  // matching, since snapshotDownloadProgress tests the prefix boundary.
  const key = `${globalName}:#${token}`;

  // Kept current in the retain effect so the stable prepare/acquire below
  // always dispatch to the live store — mirrors useLifecycle. There's no
  // adoption race here (unique key ⇒ retain always keeps our candidate), so a
  // committed-key swap isn't needed.
  const storeRef = useRef(store);
  useEffect(() => {
    retain(key, store);
    storeRef.current = store;
    return () => release(key);
    // `store` moves in lockstep with `key` — replace() sets both together — so
    // keying on `key` alone retains/releases exactly once per generation.
    // StrictMode's double-effect releases then re-retains the same candidate,
    // re-running start() (the start-after-stop path task hooks already cover).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [stable] = useState(() => ({
    prepare: (): Promise<void> => storeRef.current.prepare(),
    acquire: (callerSignal?: AbortSignal) =>
      storeRef.current.acquire(callerSignal),
    replace: (nextOptions?: Options): void => {
      if (nextOptions !== undefined) {
        optionsRef.current = nextOptions;
      }
      // A fresh store under a fresh key. The old key's release (the retain
      // effect's cleanup, run before the new key's retain) stops the old
      // store — aborting its in-flight work and destroying the session — so
      // the new store probes and provisions from scratch.
      setStore(
        createStore<Options, Model>(globalName, optionsRef.current, readQuota),
      );
      setToken(nextToken++);
    },
  }));

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
    replace: stable.replace,
  };
}
