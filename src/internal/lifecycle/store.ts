import {
  BuiltInAIError,
  MissingUserActivationError,
  NotReadyError,
  UnavailableError,
  UnsupportedError,
} from "../../errors";
import type { BuiltInAIName } from "../../is-supported";
import type { Status } from "../../types";
import { subscribeAvailability } from "../availability-store";
import { buildProgressKey } from "../progress-store";
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
  silent?: boolean;
}

type InternalState<Model> =
  | { kind: "idle"; probe: Promise<void> }
  | { kind: "downloadable" }
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

  let options: Options | undefined;
  let abortController = new AbortController();

  let provisionInFlight: Promise<void> | null = null;
  let progressKey = buildProgressKey(globalName, options);
  let unsubscribeAvailability: (() => void) | null = null;

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

  // useSyncExternalStore needs a referentially stable snapshot; recompute only
  // when `state` identity changes (a fresh object every call would loop renders).
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
        return;
      }
      transition({ kind: "downloadable" });
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      transition({ kind: "error", error: wrap(error) });
    }
  }

  async function recheckAvailability(
    changedKey: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted || provisionInFlight || state.kind !== "downloadable") {
      return;
    }
    if (changedKey !== progressKey) {
      return;
    }
    const namespace = getNamespace<Options, Model>(globalName);
    if (!namespace) {
      return;
    }
    let availability: Availability;
    try {
      availability = await namespace.availability(options);
    } catch {
      return;
    }
    if (signal.aborted || state.kind !== "downloadable") {
      return;
    }
    if (availability === "available") {
      await provision(signal, { showDownloadUI: false, silent: true });
    } else if (availability === "unavailable") {
      transition({ kind: "unavailable" });
    }
  }

  function provision(
    signal: AbortSignal,
    { showDownloadUI, silent = false }: ProvisionOptions,
  ): Promise<void> {
    if (provisionInFlight) {
      return provisionInFlight;
    }
    const task = runProvision(signal, silent);
    const inFlight = task.finally(() => {
      // Identity-checked: a stale task from a previous epoch must not clear the
      // fresh token start() installed.
      if (provisionInFlight === inFlight) {
        provisionInFlight = null;
      }
    });
    provisionInFlight = inFlight;
    if (showDownloadUI) {
      transition({ kind: "downloading", progress: 0, task: inFlight });
    }
    return inFlight;
  }

  async function runProvision(
    signal: AbortSignal,
    silent = false,
  ): Promise<void> {
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
      } else if (silent) {
        return;
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
        case "downloadable":
          if (provisionInFlight) {
            await awaitTask(provisionInFlight, callerSignal);
            continue;
          }
          kickoff();
          continue;
        case "idle":
          await awaitTask(current.probe, callerSignal);
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

  function teardownEpoch(reason: string): void {
    abortController.abort(abortError(reason));
    provisionInFlight = null;
    unsubscribeAvailability?.();
    unsubscribeAvailability = null;
    if (state.kind === "ready") {
      destroyQuietly(state.instance);
    }
  }

  function start(nextOptions: Options | undefined): void {
    teardownEpoch("lifecycle reset");
    abortController = new AbortController();
    options = nextOptions;
    progressKey = buildProgressKey(globalName, options);
    const namespace = getNamespace<Options, Model>(globalName);
    if (!namespace) {
      transition({ kind: "unsupported" });
      return;
    }
    const epoch = abortController;
    unsubscribeAvailability = subscribeAvailability((changedKey) => {
      void recheckAvailability(changedKey, epoch.signal);
    });
    transition({
      kind: "idle",
      probe: checkAvailability(namespace, abortController.signal),
    });
  }

  function stop(): void {
    teardownEpoch("lifecycle unmounted");
    transition({ kind: "idle", probe: Promise.resolve() });
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const prepare = async (): Promise<void> => {
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
    // abortController's identity is a generation token: a different one after the
    // await means start() reset our epoch out from under us (config change).
    if (epoch !== abortController) {
      throw new NotReadyError();
    }
    const merged = mergeSignals(epoch.signal, callerSignal);
    if (merged.aborted) {
      throw merged.reason;
    }
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
    acquire,
  };
}
