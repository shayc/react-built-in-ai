---
"@shayc/react-built-in-ai": minor
---

Add `retry()` and make `prepare()` warm-up-only; sharpen the user-activation error.

- **New `retry()` on every hook.** Recovers from a failed lifecycle by tearing down the errored instance, re-initializing from the current options, and warming up. This is the explicit recovery path that used to be a side effect of `prepare()`.
- **`prepare()` is now warm-up only.** From `error` state it rejects with `NotReadyError` instead of silently resetting and re-initializing. Call `retry()` to recover. From any non-`error` state, `prepare()` and `retry()` behave identically.
- **`MissingUserActivationError` now explains the fix** — its message points at calling `prepare()` (or the action) from a click/keypress handler, so the failure is self-explaining when it surfaces from an effect or timer on a first-time (uncached) user.
