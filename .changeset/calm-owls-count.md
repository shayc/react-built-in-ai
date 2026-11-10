---
"@shayc/react-built-in-ai": patch
---

`useLanguageModel` now reports `contextUsage` as soon as the session is ready. A session created with `initialPrompts` (including one provisioned by `reset()`) previously read `0` until the first `prompt()` or `append()` call.
