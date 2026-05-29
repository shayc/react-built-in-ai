import type { BuiltInAIError } from "./errors";

/**
 * Lifecycle state of a built-in AI hook. Starts at `idle` and advances to
 * `ready` — through `downloading` when the model must be fetched first — or
 * settles in a terminal `unsupported` / `unavailable` / `error`.
 */
export type Status =
  | "unsupported"
  | "unavailable"
  | "idle"
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
   * `create()` call. Invoke from a user-activation handler (click, keypress)
   * if a download may be required. Warm-up only: from `error` state this
   * rejects with `NotReadyError` rather than re-initializing — use
   * {@link BaseHookReturn.retry} to recover.
   *
   * @throws A {@link BuiltInAIError} subclass — `UnsupportedError`,
   * `UnavailableError`, `MissingUserActivationError`, or `NotReadyError`.
   */
  prepare: () => Promise<void>;
  /**
   * Recovers from a failed lifecycle: tears down the errored instance,
   * re-initializes from the current options, and warms up — the explicit retry
   * path. From any non-`error` state this behaves exactly like
   * {@link BaseHookReturn.prepare}. Invoke from a user-activation handler if a
   * download may be required.
   *
   * @throws A {@link BuiltInAIError} subclass — `UnsupportedError`,
   * `UnavailableError`, `MissingUserActivationError`, or `NotReadyError`.
   */
  retry: () => Promise<void>;
}
