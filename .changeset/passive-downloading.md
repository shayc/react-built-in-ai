---
"@shayc/react-built-in-ai": minor
---

- A hook that probes availability and finds a download already in flight elsewhere (another hook with different options, another tab, an imperative `create*` call) now reports `status: "downloading"` and joins it — gesture-free, no `MissingUserActivationError` — instead of collapsing to `"downloadable"` and staying stuck there after the download completes. This fixes stale "download required" UI for a passively-observing component while the model is actually mid-download or already finished.
- `progress` is `null` while `status === "downloading"` until the browser actually reports a fraction via a `downloadprogress` event — it no longer fabricates a starting `0`. This applies to every download, not just joined ones: a hook-driven download you triggered yourself now also starts at `null` and moves to a number only once the browser says so. `useGlobalDownloadProgress()`'s aggregate is unaffected — it coalesces an in-flight download with no signal yet to `0`.
- Imperative `create*` factories (`createTranslator`, `createRewriter`, etc.) no longer throw `MissingUserActivationError` when called without a gesture while a download is already in flight — they join it, same as a hook. A gesture is still required to _start_ a download.
