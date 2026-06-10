---
"@shayc/react-built-in-ai": minor
---

Add a `downloadable` lifecycle status. The hook previously parked in `idle` when the model needed a download, indistinguishable from a probe still in flight — consumers had to re-call `availability()` themselves to know when to render a download affordance. `checkAvailability` now surfaces what it learns: `idle` is strictly "probing availability", and `downloadable` means the model awaits the user gesture Chrome requires before a fetch. `prepare()` (or any action method) called from a user activation moves it through `downloading` to `ready`, exactly as before.

Breaking for exhaustive `switch`es over `Status` (they'll get a compile error pointing at the new state) and for any code that treated a settled `idle` as "download required" — that state is now named.
