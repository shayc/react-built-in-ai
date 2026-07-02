---
"@shayc/react-built-in-ai": minor
---

Actions and `prepare()` now recover from a parked `downloadable` state without a user gesture once the model is already on-device elsewhere (another component, another tab) — previously they'd throw `MissingUserActivationError` even though no download was actually needed anymore.

- A gesture-less call from `downloadable` re-probes availability once; if the model turns out to already be available, it provisions quietly and reaches `ready`. If it's still genuinely downloadable, the call throws `MissingUserActivationError` as before (bounded to one extra probe — no spinning).
- Mid-flight lifecycle resets (a `prepare()` retry, or a same-key restart racing an in-progress `acquire()`) now reject with a `DOMException` named `AbortError` instead of `NotReadyError`, since the request was cancelled rather than failed — filter it the same way you'd filter any other abort (`error.name === "AbortError"`).
- `NotReadyError`'s message is corrected to describe its narrowed remaining meaning: a prior `create()` rejected; inspect `.cause` for the underlying rejection.
