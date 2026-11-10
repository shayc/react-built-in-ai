---
"@shayc/react-built-in-ai": patch
---

Fix two lifecycle edge cases:

- `useLanguageModel` now reports `contextUsage` as soon as the session is ready. A session created with `initialPrompts` (including one provisioned by `reset()`) previously read `0` until the first `prompt()` or `append()` call.
- Task-hook actions and `prepare()` called before the hook's own mount effect has run — from a child component's effect or a layout effect — now wait for the lifecycle to start instead of rejecting with `AbortError: lifecycle reset`. A child effect that fires on an options change likewise reaches the new options' instance rather than the one being torn down.
