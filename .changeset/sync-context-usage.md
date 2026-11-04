---
"@shayc/react-built-in-ai": patch
---

`useLanguageModel` now reports `contextUsage` as soon as the session is ready, so tokens consumed by `initialPrompts` show up before the first prompt. Task hooks now also normalize nested option key order when deciding whether to share an instance.
