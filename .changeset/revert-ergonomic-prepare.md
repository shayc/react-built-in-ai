---
"@shayc/react-built-in-ai": minor
---

Restore the ergonomic `prepare()` and remove `retry()`.

Reverts the prepare/retry split from the previous release. `prepare()` once again recovers from `error` state — it tears down the failed instance, re-initializes from the current options, and warms up — so a single method drives the model to `ready` from any state. The separate `retry()` introduced last release is removed; call `prepare()` to recover instead.

The improved `MissingUserActivationError` message (pointing at calling `prepare()` from a user-activation handler) is unaffected and stays.
