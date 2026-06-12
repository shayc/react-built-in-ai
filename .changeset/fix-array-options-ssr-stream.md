---
"@shayc/react-built-in-ai": patch
---

Lifecycle and streaming fixes:

- Inline array-valued options (e.g. `expectedInputLanguages: ["en"]`) no longer crash with "Too many re-renders" — option arrays are compared element-wise.
- Hooks no longer throw during SSR: both `useSyncExternalStore` call sites now provide a server snapshot (idle lifecycle, `null` download progress), with clean hydration.
- Exiting a streaming loop early (`break`/`throw`) now cancels the underlying stream instead of leaving the model generating into an abandoned reader.
- Per-call options are forwarded to the browser APIs wholesale (`{ ...opts, signal }`), so future upstream option fields flow through instead of being dropped.
