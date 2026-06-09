---
"@shayc/react-built-in-ai": minor
---

`useGlobalDownloadProgress` now aggregates with min instead of max: it reports the least-complete in-flight download, so the value never moves backwards when one of several concurrent downloads finishes. It also accepts an array to scope aggregation to multiple namespaces: `useGlobalDownloadProgress(["Proofreader", "Rewriter"])`. Single-namespace, explicit-`undefined`, and no-argument calls keep working unchanged; only the aggregated value differs when more than one download is in flight.
