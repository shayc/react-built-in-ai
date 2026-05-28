---
"@shayc/react-built-in-ai": minor
---

Add the remaining Built-in AI task APIs: `useSummarizer`/`createSummarizer`, `useWriter`/`createWriter`, and `useLanguageDetector`/`createLanguageDetector`. Summarizer and Writer expose the same `summarize`/`write` + streaming + `measureInput`/`inputQuota` surface as the existing hooks; `useLanguageDetector.detect` resolves with the browser's ranked `LanguageDetectionResult[]` and has no streaming variant. `isSupported` and `useGlobalDownloadProgress` now accept the three new namespace names.
