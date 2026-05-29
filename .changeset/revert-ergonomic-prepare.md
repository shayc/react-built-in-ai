---
"@shayc/react-built-in-ai": minor
---

Restore the ergonomic `prepare()` and remove `retry()`.

Reverts the prepare/retry split from the previous release. `prepare()` once again recovers from `error` state — it tears down the failed instance, re-initializes from the current options, and warms up — so a single method drives the model to `ready` from any state. The separate `retry()` introduced last release is removed; call `prepare()` to recover instead.

The `MissingUserActivationError` message is also sharpened: it now frames a click/keypress as examples of a transient user activation (not the rule), says to call `prepare()` or the action directly inside such a handler, and names the real traps — effects, timers, page load, and post-`await` activation expiry.
