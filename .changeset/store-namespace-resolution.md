---
"@shayc/react-built-in-ai": patch
---

Resolve the built-in AI namespace inside the lifecycle store instead of the React hook. `useLifecycle` now passes only the API name down and no longer reads `globalThis` during render; the store resolves the namespace itself (live, per epoch) for the availability probe.

No public API or behavior change — an internal cleanup that removes the cached namespace, a `start` parameter, and a dead guard, and keeps namespace resolution out of the React layer.
