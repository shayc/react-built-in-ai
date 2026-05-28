---
"@shayc/react-built-in-ai": patch
---

Broaden the supported Node engine to `>=22`. The published package runs in the browser and has no Node-24-only requirements, so Node 22 (LTS) consumers no longer get an `EBADENGINE` warning on install. Verified against a Node 22/24 CI matrix.
