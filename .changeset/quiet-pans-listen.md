---
"@shayc/react-built-in-ai": patch
---

Task-hook actions and `prepare()` called before the hook's own mount effect has run — from a child component's effect or a layout effect — now wait for the lifecycle to start instead of rejecting with `AbortError: lifecycle reset`. A child effect that fires on an options change likewise reaches the new options' instance rather than the one being torn down.

Rendering `useLanguageModel` no longer calls `Promise.withResolvers`, so the hook renders without throwing on browsers that predate it.
