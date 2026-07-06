---
"@shayc/react-built-in-ai": patch
---

Fix `raceAbort` masking non-Error rejections as `AbortError` — a rejection with a non-Error reason (e.g. a rejected string) was coerced through the same path used for abort reasons, so genuine rejections were misreported as cancellations.
