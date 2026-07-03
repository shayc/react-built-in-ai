---
"@shayc/react-built-in-ai": minor
---

Add `checkAvailability(name, options?)` — a lightweight readiness probe that returns the browser's own `availability()` result (`"available" | "downloadable" | "downloading" | "unavailable"`) without mounting a hook or creating an instance. Useful for a capability list or settings screen that needs a real status for options the user hasn't committed to yet. Throws `UnsupportedError` when the namespace global is absent.
