---
"@shayc/react-built-in-ai": patch
---

Fix `acquire()` rejecting with a raw, untyped `Error` ("Unexpected lifecycle state") when called after the hook unmounts mid-download. It now rejects with a typed `AbortError`, consistent with every other teardown/abort path.

Internally, the lifecycle store is modeled as a discriminated-union state machine, so a `ready` state owns its instance by construction — eliminating the desync between `status` and the live instance that produced the raw throw.
