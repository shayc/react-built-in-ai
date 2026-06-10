import type { BuiltInAIError } from "./errors";

/**
 * Lifecycle state of a built-in AI hook. Starts at `idle` (probing
 * availability) and advances to `ready` — pausing at `downloadable` until a
 * user gesture authorizes the fetch, then through `downloading` — or settles
 * in a terminal `unsupported` / `unavailable` / `error`. `downloadable`
 * mirrors the browser's `availability()` vocabulary.
 */
export type Status =
  | "unsupported"
  | "unavailable"
  | "idle"
  | "downloadable"
  | "downloading"
  | "ready"
  | "error";

/** Fields shared by every built-in AI hook return value. */
export interface BaseHookReturn {
  /** Current lifecycle state. See {@link Status} for transitions. */
  status: Status;
  /** `0..1` while `status === "downloading"`; `0` otherwise. */
  progress: number;
  /** Last lifecycle error; inspect `.cause` for the underlying browser rejection. */
  error: BuiltInAIError | null;
  /**
   * Pre-warms the model — triggers any required download and the underlying
   * `create()` call. From `downloadable`, invoke it from a user-activation
   * handler (click, keypress) — the browser only starts a model download on a
   * gesture. From `error` state it tears down the failed instance and
   * re-initializes, so it doubles as the recovery/retry path.
   *
   * @throws A {@link BuiltInAIError} subclass — `UnsupportedError`,
   * `UnavailableError`, `MissingUserActivationError`, or `NotReadyError`.
   */
  prepare: () => Promise<void>;
}
