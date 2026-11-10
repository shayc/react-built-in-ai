---
"@shayc/react-built-in-ai": minor
---

Add an optional `onDownloadProgress` callback to the imperative `create*` factories. It is called only when creating the instance involves a model download — once with `0` as soon as the download is known, then with each new `downloadprogress` fraction — so a caller can learn about the download from inside its own call. It is never called when the model is already available or after the factory's promise settles, and is not forwarded to the browser's `create()`.
