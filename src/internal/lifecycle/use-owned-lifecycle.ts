import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BuiltInAIName } from "../../is-supported";
import { abortError, mergeSignals, raceAbort } from "../signal";
import { release, retain, type Store } from "./registry";
import { createStore } from "./store";

let nextToken = 0;

interface OwnedGeneration<
  Options extends object,
  Model extends DestroyableModel,
> {
  key: string;
  store: Store<Options, Model>;
  activate(): void;
  cancelActivation(reason: unknown): void;
  waitForActivation(callerSignal?: AbortSignal): Promise<void>;
}

function createOwnedGeneration<
  Options extends object,
  Model extends DestroyableModel,
>(
  globalName: BuiltInAIName,
  options: Options | undefined,
  readQuota?: (instance: Model) => number,
): OwnedGeneration<Options, Model> {
  const store = createStore<Options, Model>(globalName, options, readQuota);
  const activationController = new AbortController();
  const { promise: activation, resolve } = Promise.withResolvers<void>();
  let activated = false;

  return {
    key: `${globalName}:#${nextToken++}`,
    store,
    activate() {
      if (activated || activationController.signal.aborted) {
        return;
      }
      activated = true;
      resolve();
    },
    cancelActivation(reason: unknown) {
      if (!activated) {
        activationController.abort(reason);
      }
    },
    waitForActivation(callerSignal?: AbortSignal) {
      return raceAbort(
        activation,
        mergeSignals(activationController.signal, callerSignal),
      );
    },
  };
}

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

  const [generation, setGeneration] = useState(() =>
    createOwnedGeneration<Options, Model>(globalName, options, readQuota),
  );
  // Route actions immediately; activation waits for the retain effect.
  const currentGenerationRef = useRef(generation);
  const pendingGenerationRef = useRef<OwnedGeneration<Options, Model> | null>(
    generation,
  );

  // A replacement can be selected synchronously and then never commit because
  // the component unmounts. It has not started, so cancel its activation waiters
  // without needing store teardown or registry cleanup.
  useEffect(
    () => () => {
      pendingGenerationRef.current?.cancelActivation(
        abortError("language model reset interrupted by unmount"),
      );
    },
    [],
  );

  useEffect(() => {
    retain(generation.key, generation.store);
    if (pendingGenerationRef.current === generation) {
      pendingGenerationRef.current = null;
    }
    generation.activate();
    return () => release(generation.key);
    // Each generation owns one immutable key/store pair, so the effect retains
    // and releases exactly once per committed reset.
    // StrictMode's double-effect releases then re-retains the same candidate,
    // re-running start() (the start-after-stop path task hooks already cover).
  }, [generation]);

  const [stable] = useState(() => ({
    prepare: async (): Promise<void> => {
      const selected = currentGenerationRef.current;
      await selected.waitForActivation();
      return selected.store.prepare();
    },
    acquire: async (callerSignal?: AbortSignal) => {
      const selected = currentGenerationRef.current;
      await selected.waitForActivation(callerSignal);
      return selected.store.acquire(callerSignal);
    },
    replace: (nextOptions?: Options): void => {
      if (nextOptions !== undefined) {
        optionsRef.current = nextOptions;
      }

      const replacement = createOwnedGeneration<Options, Model>(
        globalName,
        optionsRef.current,
        readQuota,
      );
      // Cancel an uncommitted replacement, then route to the newest one.
      currentGenerationRef.current.cancelActivation(
        abortError("language model reset superseded by a newer reset"),
      );
      currentGenerationRef.current = replacement;
      pendingGenerationRef.current = replacement;
      setGeneration(replacement);
    },
  }));

  const snapshot = useSyncExternalStore(
    generation.store.subscribe,
    generation.store.getSnapshot,
    generation.store.getSnapshot,
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
