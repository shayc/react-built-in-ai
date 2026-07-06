---
"@shayc/react-built-in-ai": minor
---

`checkAvailability()` is now typed per-API instead of accepting any `object`: options are required for `"Translator"` (matching the platform, which needs a language pair to answer meaningfully) and, for every name, must match that API's real `availability()` shape (its `*CreateCoreOptions`) rather than accepting arbitrary or cross-API option bags. `create()`-only members like `sharedContext` are correctly rejected too, since `availability()` never consumed them.

This is breaking for types only, and fixes a real bug: `checkAvailability("Translator")` previously compiled but threw a `TypeError` at runtime. Callers iterating `BuiltInAIName` option-free for a capability list should use `isSupported("Translator")` for the existence check, or supply a language pair to probe real availability. The new `AvailabilityOptionsMap` and `BuiltInAIAvailability` types are exported for anyone building a generic wrapper.
