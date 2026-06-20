---
"@shayc/react-built-in-ai": minor
---

Sibling hook instances now converge to `ready` after a device-wide model download, without a remount or a redundant user gesture (#53).

- Mounted hooks of the same namespace + options that are parked at `downloadable` re-probe and silently provision (`status: downloadable → ready`, no `downloading` flash, no re-download) once any sibling instance — or an imperative `create*()` — completes the download. Internally this is a new module-level availability-invalidation signal, a peer of the download-progress store; convergence is fully automatic with no new public API.
- Convergence keys on the per-config download key, and every woken instance re-confirms its own `availability(options)`, so a different-config sibling correctly stays parked (model availability is per-config).
- A background re-probe whose `create()` fails leaves the instance parked at `downloadable` instead of surfacing `error` — only a user-initiated `prepare()`/action reports real errors.
- `provision()` is now single-flight per lifecycle epoch: a background convergence and a concurrent gesture-driven `acquire()`/`prepare()` coalesce onto one `create()` (no duplicate, leaked instance), and a reactive `acquire()` landing mid-convergence joins it instead of throwing `MissingUserActivationError`.
