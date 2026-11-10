import { mergeSignals, raceAbort } from "../signal";

/**
 * A one-shot latch for "the lifecycle behind this hook has started". Calls
 * that arrive early — before the hook's retain effect has run — wait on it
 * instead of reaching a store that is not live yet.
 *
 * @internal
 */
export interface Gate {
  /** Releases every waiter, now and in future. A no-op once cancelled. */
  open(): void;
  /** Rejects every waiter with `reason`. A no-op once opened. */
  cancel(reason: unknown): void;
  /**
   * Resolves once the gate opens; rejects if it is cancelled or
   * `callerSignal` aborts first. An open gate still settles asynchronously —
   * a few microtasks later, which is after the synchronous effect flush the
   * caller is running in.
   */
  wait(callerSignal?: AbortSignal): Promise<void>;
}

/** @internal */
export function createGate(): Gate {
  const cancellation = new AbortController();
  let isOpen = false;
  // Hand-rolled rather than `Promise.withResolvers`: gates are created during
  // render, which must stay safe on browsers that predate it — those are the
  // browsers a hook is supposed to report "unsupported" on, not crash in.
  let resolve!: () => void;
  const opened = new Promise<void>((r) => {
    resolve = r;
  });

  return {
    open() {
      if (isOpen || cancellation.signal.aborted) {
        return;
      }
      isOpen = true;
      resolve();
    },
    cancel(reason) {
      if (!isOpen) {
        cancellation.abort(reason);
      }
    },
    wait(callerSignal) {
      return raceAbort(opened, mergeSignals(cancellation.signal, callerSignal));
    },
  };
}
