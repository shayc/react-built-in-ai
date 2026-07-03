import type { BuiltInAIError } from "./errors";

/**
 * Lifecycle state of a built-in AI hook. Starts at `checking` (probing
 * availability, or quietly creating an already-downloaded model) and
 * advances to `ready` — pausing at `downloadable` until a user gesture
 * authorizes the fetch, then through `downloading` — or settles in a
 * terminal `unsupported` / `unavailable` / `error`. `downloadable` mirrors
 * the browser's `availability()` vocabulary.
 *
 * `downloading` is also entered passively, without this hook driving the
 * fetch itself, when the probe finds a download already in flight (started
 * by another hook, another tab, or an imperative `create*` call) — the store
 * joins it gesture-free and reports its progress like any other download.
 */
export type Status =
  | "unsupported"
  | "unavailable"
  | "checking"
  | "downloadable"
  | "downloading"
  | "ready"
  | "error";

/** Fields shared by every built-in AI hook return value. */
export interface BaseHookReturn {
  /** Current lifecycle state. See {@link Status} for transitions. */
  status: Status;
  /**
   * `0..1` while `status === "downloading"` once the browser has reported a
   * fraction via `downloadprogress`; `null` otherwise, including while
   * `status === "downloading"` but no such event has arrived yet (e.g. a
   * download just joined, or a browser that doesn't emit progress events to
   * joining monitors). A `number` here always reflects a real browser
   * report — the hook never fabricates a starting value.
   */
  progress: number | null;
  /** Last lifecycle error; inspect `.cause` for the underlying browser rejection. */
  error: BuiltInAIError | null;
  /**
   * Pre-warms the model — triggers any required download and the underlying
   * `create()` call. From `downloadable`, invoke it from a user-activation
   * handler (click, keypress) — the browser only starts a model download on a
   * gesture. From `error` state it tears down the failed instance and
   * re-initializes, so it doubles as the recovery/retry path.
   *
   * Hooks with equal options share one underlying instance (see the
   * "Instance sharing" section of the README) — `prepare()` restarts that
   * shared instance, so a retry from one component is visible to every
   * component sharing it, not just the caller. That restart also aborts any
   * other sharing component's in-flight action call or `prepare()`/gate
   * resolution — those reject with a `DOMException` named `AbortError`,
   * which should be filtered like any other cancellation
   * (`error.name === "AbortError"`), not treated as a failure.
   *
   * Since `status` already reflects everything user-facing, a fire-and-forget
   * `prepare().catch(() => {})` from a gesture handler is a reasonable way to
   * pre-warm without surfacing a redundant rejection.
   *
   * @throws A {@link BuiltInAIError} subclass — `UnsupportedError`,
   * `UnavailableError`, `MissingUserActivationError`, or `NotReadyError`. Can
   * also reject with a `DOMException` named `AbortError` when a sibling
   * component sharing this store restarts it mid-flight (see above).
   */
  prepare: () => Promise<void>;
}
