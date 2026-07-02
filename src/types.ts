import type { BuiltInAIError } from "./errors";

/**
 * Lifecycle state of a built-in AI hook. Starts at `checking` (probing
 * availability, or quietly creating an already-downloaded model) and
 * advances to `ready` — pausing at `downloadable` until a user gesture
 * authorizes the fetch, then through `downloading` — or settles in a
 * terminal `unsupported` / `unavailable` / `error`. `downloadable` mirrors
 * the browser's `availability()` vocabulary.
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
  /** `0..1` while `status === "downloading"`; `null` otherwise — `null` (not `0`) distinguishes "nothing downloading" from "just started at 0%". */
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
   * component sharing it, not just the caller.
   *
   * Since `status` already reflects everything user-facing, a fire-and-forget
   * `prepare().catch(() => {})` from a gesture handler is a reasonable way to
   * pre-warm without surfacing a redundant rejection.
   *
   * @throws A {@link BuiltInAIError} subclass — `UnsupportedError`,
   * `UnavailableError`, `MissingUserActivationError`, or `NotReadyError`.
   */
  prepare: () => Promise<void>;
}
