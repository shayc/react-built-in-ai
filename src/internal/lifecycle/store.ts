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
import { createInstance } from "./create-instance";
import { getNamespace, type AINamespace } from "./types";

export interface Snapshot {
  status: Status;
  progress: number;
  error: BuiltInAIError | null;
  inputQuota: number;
}

export interface Acquired<Model> {
  instance: Model;
  signal: AbortSignal;
}

interface ProvisionOptions {
  showDownloadUI: boolean;
}

type InternalState<Model> =
  | { kind: "idle"; probe: Promise<void> }
  | { kind: "downloading"; progress: number; task: Promise<void> }
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
        progress: 0,
        error: null,
        inputQuota: state.inputQuota,
      };
    case "error":
      return {
        status: "error",
        progress: 0,
        error: state.error,
        inputQuota: 0,
      };
    default:
      return { status: state.kind, progress: 0, error: null, inputQuota: 0 };
  }
}

function wrap(error: unknown): BuiltInAIError {
  if (error instanceof BuiltInAIError) {
    return error;
  }
  return new BuiltInAIError(
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

function destroyQuietly(instance: DestroyableModel | null | undefined): void {
  if (!instance) {
    return;
  }
  try {
    instance.destroy();
  } catch {
    // Best-effort during teardown — a throw here has nowhere to go.
  }
}

export function createStore<
  Options extends object,
  Model extends DestroyableModel,
>(globalName: BuiltInAIName, readQuota: (instance: Model) => number = () => 0) {
  const listeners = new Set<() => void>();

  // Epoch context, orthogonal to `state` — reset wholesale by start/stop. The
  // controller's identity is the generation token acquire() checks after awaiting.
  let options: Options | undefined;
  let abortController = new AbortController();

  let state: InternalState<Model> = { kind: "idle", probe: Promise.resolve() };
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

  async function checkAvailability(
    namespace: AINamespace<Options, Model>,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const availability = await namespace.availability(options);
      if (signal.aborted) {
        return;
      }
      if (availability === "unavailable") {
        transition({ kind: "unavailable" });
        return;
      }
      if (availability === "available") {
        await provision(signal, { showDownloadUI: false });
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      transition({ kind: "error", error: wrap(error) });
    }
  }

  function provision(
    signal: AbortSignal,
    { showDownloadUI }: ProvisionOptions,
  ): Promise<void> {
    const task = runProvision(signal);
    if (showDownloadUI) {
      transition({ kind: "downloading", progress: 0, task });
    }
    return task;
  }

  async function runProvision(signal: AbortSignal): Promise<void> {
    try {
      const created = await createInstance<Options, Model>({
        name: globalName,
        options,
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
      } else {
        transition({ kind: "error", error: wrap(error) });
      }
    }
  }

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

  async function ensureReady(callerSignal?: AbortSignal): Promise<void> {
    while (true) {
      const current = state;
      switch (current.kind) {
        case "ready":
          return;
        case "unsupported":
          throw new UnsupportedError();
        case "unavailable":
          throw new UnavailableError();
        case "error":
          throw new NotReadyError(current.error.cause);
        case "downloading":
          await awaitTask(current.task, callerSignal);
          continue;
        case "idle":
          await awaitTask(current.probe, callerSignal);
          // Re-read live state: a concurrent caller may have kicked off already,
          // so a single create() is shared rather than duplicated.
          if (state.kind === "idle") {
            kickoff();
          }
          continue;
      }
    }
  }

  function kickoff(): void {
    if (!hasUserActivation()) {
      throw new MissingUserActivationError();
    }
    void provision(abortController.signal, { showDownloadUI: true });
  }

  function start(nextOptions: Options | undefined): void {
    abortController.abort(abortError("lifecycle reset"));
    abortController = new AbortController();
    if (state.kind === "ready") {
      destroyQuietly(state.instance);
    }
    options = nextOptions;
    const namespace = getNamespace<Options, Model>(globalName);
    if (!namespace) {
      transition({ kind: "unsupported" });
      return;
    }
    transition({
      kind: "idle",
      probe: checkAvailability(namespace, abortController.signal),
    });
  }

  function stop(): void {
    abortController.abort(abortError("lifecycle unmounted"));
    if (state.kind === "ready") {
      destroyQuietly(state.instance);
    }
    transition({ kind: "idle", probe: Promise.resolve() });
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  // Warm up only — never tears down. From an errored lifecycle this rejects
  // with NotReadyError; use retry() to reset and try again.
  const prepare = async (): Promise<void> => {
    await ensureReady();
  };

  // Recover from a failed lifecycle: reset the errored epoch, then warm up.
  // A no-op reset elsewhere — from any non-error state this is just prepare().
  const retry = async (): Promise<void> => {
    if (state.kind === "error") {
      start(options);
    }
    await ensureReady();
  };

  const acquire = async (
    callerSignal?: AbortSignal,
  ): Promise<Acquired<Model>> => {
    const epoch = abortController;
    await ensureReady(callerSignal);
    // start() during the await installs a fresh controller — a different
    // identity means our generation was reset out from under us (config change).
    if (epoch !== abortController) {
      throw new NotReadyError();
    }
    const merged = mergeSignals(epoch.signal, callerSignal);
    if (merged.aborted) {
      throw merged.reason;
    }
    // Provably "ready" in an unchanged epoch; the guard narrows `state.instance`.
    if (state.kind !== "ready") {
      throw new NotReadyError();
    }
    return { instance: state.instance, signal: merged };
  };

  return {
    subscribe,
    getSnapshot,
    start,
    stop,
    prepare,
    retry,
    acquire,
  };
}
