---
"@shayc/react-built-in-ai": minor
---

`useGlobalDownloadProgress` now returns `number | null` — `null` when nothing is downloading, instead of `0`. This lets callers distinguish "no download in flight" from "download just started at 0%". Update guards from `progress === 0` to `progress === null`.
