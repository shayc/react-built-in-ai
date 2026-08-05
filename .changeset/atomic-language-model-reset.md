---
"@shayc/react-built-in-ai": patch
---

Make `useLanguageModel.reset()` an atomic action boundary so immediate `prompt()` and `prepare()` calls wait for the replacement session instead of reaching the discarded conversation.
