import {
  BuiltInAIError,
  MissingUserActivationError,
  NotReadyError,
  UnavailableError,
  UnsupportedError,
} from "../../errors";
import type { BuiltInAIName } from "../../is-supported";
import type { Status } from "../../types";
import { abortError, mergeSignals, raceAbort } from "../signal";
import { hasUserActivation } from "../user-activation";
import { provisionInstance } from "./provision";
import { getNamespace, type AINamespace } from "./types";

interface Snapshot {
  status: Status;
  progress: number | null;
  error: BuiltInAIError | null;
  inputQuota: number;
}

interface Acquired<Model> {
  instance: Model;
  signal: AbortSignal;
}

type InternalState<Model> =
  | { kind: "checking"; probe: Promise<void> }
  | { kind: "downloadable" }
  | { kind: "downloading"; progress: number | null; task: Promise<void> }
  | { kind: "ready"; instance: Model; inputQuota: number }
  | { kind: "unsupported" }
  | { kind: "unavailable" }
  | { kind: "error"; error: BuiltInAIError };

function toSnapshot<Model>(state: InternalState<Model>): Snapshot {
  switch (state.kind) {
    case "downloading":
      return {
        status: "downloading",
        progress: state.progress,
        error: null,
        inputQuota: 0,
      };
    case "ready":
      return {
        status: "ready",
        progress: null,
        error: null,
        inputQuota: state.inputQuota,
      };
    case "error":
      return {
        status: "error",
        progress: null,
        error: state.error,
        inputQuota: 0,
      };
    default:
      return { status: state.kind, progress: null, error: null, inputQuota: 0 };
  }
}

function toBuiltInAIError(error: unknown): BuiltInAIError {
  if (error instanceof BuiltInAIError) {
    return error;
  }
  return new BuiltInAIError(
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

function destroyQuietly(instance: DestroyableModel): void {
  try {
    instance.destroy();
  } catch {
    // Best-effort during teardown — a throw here has nowhere to go.
  }
}

export function createStore<
  Options extends object,
  Model extends DestroyableModel,
>(
  globalName: BuiltInAIName,
  options: Options | undefined,
  readQuota: (instance: Model) => number = () => 0,
) {
  const listeners = new Set<() => void>();

  // Epoch context, orthogonal to `state`. start() resets it wholesale;
  // stop() only aborts the current controller. The controller's identity is
  // the generation token acquire() checks after awaiting. `options` is fixed
  // for this store's lifetime — a different options value is a different
  // registry key, hence a different store.
  let namespace: AINamespace<Options, Model> | undefined;
  let abortController = new AbortController();

  let state: InternalState<Model> = {
    kind: "checking",
    probe: Promise.resolve(),
  };
  let projectedFrom: InternalState<Model> = state;
  let projection: Snapshot = toSnapshot(state);

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function transition(next: InternalState<Model>): void {
    state = next;
    notify();
  }

  // `useSyncExternalStore` requires a referentially stable snapshot between
  // changes; recompute the projection only when `state` identity changes.
  function getSnapshot(): Snapshot {
    if (state !== projectedFrom) {
      projectedFrom = state;
      projection = toSnapshot(state);
    }
    return projection;
  }

  // Probes availability and settles the store: "unavailable" is terminal,
  // "available" provisions immediately, "downloading" joins an in-flight
  // external download (gesture-free — activation authorizes starting a
  // fetch, not observing one), and "downloadable" parks until prepare() or
  // an action provides a gesture. A browser that refuses a gesture-free
  // join anyway is re-parked by runProvision()'s NotAllowedError case.
  // Used both for the initial probe (from start()) and to revalidate a parked
  // store without a gesture (from ensureReady()'s "downloadable" case) — both
  // are "is a download still actually required?" questions with the same answer.
  async function runProbe(signal: AbortSignal): Promise<void> {
    try {
      const availability = await namespace!.availability(options);
      if (signal.aborted) {
        return;
      }
      if (availability === "unavailable") {
        transition({ kind: "unavailable" });
        return;
      }
      if (availability === "available") {
        await provision(signal, availability);
        return;
      }
      if (availability === "downloading") {
        // Join gesture-free: the probe's job is to decide, not to download —
        // don't await, or this promise stays pending for the whole download
        // and pins the store in "checking" the entire time.
        void provision(signal, availability);
        return;
      }
      // "downloadable": a fetch is needed, and starting one requires a user
      // gesture — park until prepare() or an action provides it.
      transition({ kind: "downloadable" });
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      transition({ kind: "error", error: toBuiltInAIError(error) });
    }
  }

  function provision(
    signal: AbortSignal,
    availability: Availability,
  ): Promise<void> {
    const task = runProvision(signal, availability);
    if (availability !== "available") {
      // null, not 0: a number means the browser actually reported this
      // fraction via downloadprogress. A joined download may already be
      // partway done; claiming 0 here would be a fabrication either way.
      transition({ kind: "downloading", progress: null, task });
    }
    return task;
  }

  async function runProvision(
    signal: AbortSignal,
    availability: Availability,
  ): Promise<void> {
    try {
      const created = await provisionInstance<Options, Model>({
        namespace: namespace!,
        options,
        availability,
        signal,
        onProgress: (progress) => {
          if (signal.aborted) {
            return;
          }
          if (state.kind === "downloading") {
            transition({ ...state, progress });
          }
        },
      });
      if (signal.aborted) {
        destroyQuietly(created);
        return;
      }
      transition({
        kind: "ready",
        instance: created,
        inputQuota: readQuota(created),
      });
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      if (error instanceof UnsupportedError) {
        transition({ kind: "unsupported" });
      } else if (error instanceof UnavailableError) {
        transition({ kind: "unavailable" });
      } else if (error instanceof MissingUserActivationError) {
        // beginDownload() doesn't gate on activation itself — provisionInstance()
        // is the actual gate, reached only when a caller drove provisioning
        // without one. Re-park rather than surface as a hard error.
        transition({ kind: "downloadable" });
      } else if (
        error instanceof DOMException &&
        error.name === "NotAllowedError"
      ) {
        // A joining create() can be refused by a browser that requires
        // activation even to join an in-flight download — "needs a gesture",
        // not "broken". Re-park like the activation gate above rather than
        // landing in the terminal "error" state. NotAllowedError is also
        // what a permission-policy denial throws, but that can't reach here:
        // a policy-denied context answers "unavailable" at the probe, so the
        // store terminates before create() is ever attempted.
        transition({ kind: "downloadable" });
      } else {
        transition({ kind: "error", error: toBuiltInAIError(error) });
      }
    }
  }

  // Swallows non-abort rejections deliberately: a failed task has already
  // transitioned the store, and ensureReady()'s loop re-reads that state and
  // throws the canonical error — rethrowing here would surface it twice.
  async function awaitTask(
    task: Promise<void>,
    callerSignal: AbortSignal | undefined,
  ): Promise<void> {
    const merged = mergeSignals(abortController.signal, callerSignal);
    try {
      await raceAbort(task, merged);
    } catch (error) {
      if (merged.aborted) {
        throw error;
      }
    }
  }

  async function ensureReady(callerSignal?: AbortSignal): Promise<Model> {
    // Bounds the "downloadable" case's gesture-less revalidation to one probe
    // per call — without it, availability repeatedly answering "downloadable"
    // would retry forever instead of surfacing MissingUserActivationError.
    let reprobed = false;
    while (true) {
      const current = state;
      switch (current.kind) {
        case "ready":
          return current.instance;
        case "unsupported":
          throw new UnsupportedError();
        case "unavailable":
          throw new UnavailableError();
        case "error":
          throw new NotReadyError(current.error.cause);
        case "downloading":
          await awaitTask(current.task, callerSignal);
          continue;
        case "downloadable":
          if (hasUserActivation()) {
            beginDownload();
            continue;
          }
          // No gesture: the model may have finished downloading — or still
          // be mid-download — elsewhere (another component's hook, another
          // tab) since this store last checked. Re-probe once: a finished
          // download provisions, an in-flight one is joined; only if it's
          // genuinely still downloadable stay parked and require a gesture.
          if (reprobed) {
            throw new MissingUserActivationError();
          }
          reprobed = true;
          transition({
            kind: "checking",
            probe: runProbe(abortController.signal),
          });
          continue;
        case "checking":
          await awaitTask(current.probe, callerSignal);
          // A settled probe always transitions out of "checking", so this is
          // unreachable today — kept so a future settle path that forgets to
          // transition fails through beginDownload() without a gesture instead
          // of spinning (runProvision() re-parks on MissingUserActivationError).
          if (state.kind === "checking") {
            beginDownload();
          }
          continue;
      }
    }
  }

  function beginDownload(): void {
    // No activation gate here — provisionInstance() is the single gate for
    // the whole library. Callers that already confirmed a gesture (the
    // "downloadable" case above) pass straight through; a caller that
    // didn't gets MissingUserActivationError from runProvision(), which
    // re-parks at "downloadable" rather than erroring out.
    void provision(abortController.signal, "downloadable");
  }

  // Called once by the registry when this store is first retained, and
  // again by prepare()'s error-retry — options never change, so there's
  // nothing else that would need a restart.
  function start(): void {
    abortController.abort(abortError("lifecycle reset"));
    abortController = new AbortController();
    if (state.kind === "ready") {
      destroyQuietly(state.instance);
    }
    namespace = getNamespace<Options, Model>(globalName);
    if (!namespace) {
      transition({ kind: "unsupported" });
      return;
    }
    transition({
      kind: "checking",
      probe: runProbe(abortController.signal),
    });
  }

  function stop(): void {
    abortController.abort(abortError("lifecycle unmounted"));
    if (state.kind === "ready") {
      destroyQuietly(state.instance);
    }
    transition({ kind: "checking", probe: Promise.resolve() });
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const prepare = async (): Promise<void> => {
    if (state.kind === "error") {
      start();
    }
    await ensureReady();
  };

  const acquire = async (
    callerSignal?: AbortSignal,
  ): Promise<Acquired<Model>> => {
    const epoch = abortController;
    const instance = await ensureReady(callerSignal);
    // start() during the await installs a fresh controller — a different
    // identity means our generation was reset out from under us (only
    // prepare()'s error-retry restarts an already-retained store). The old
    // epoch's controller was aborted, so this is a cancellation, not a
    // failure — surface it as one.
    if (epoch !== abortController) {
      throw abortError(
        "Built-in AI lifecycle reset while the request was in flight",
      );
    }
    const merged = mergeSignals(epoch.signal, callerSignal);
    if (merged.aborted) {
      throw merged.reason;
    }
    return { instance, signal: merged };
  };

  return {
    subscribe,
    getSnapshot,
    start,
    stop,
    prepare,
    acquire,
  };
}
